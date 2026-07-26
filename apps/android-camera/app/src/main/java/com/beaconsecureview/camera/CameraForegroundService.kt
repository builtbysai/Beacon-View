package com.beaconsecureview.camera

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.camera.view.PreviewView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.webrtc.IceCandidate

object CameraRuntime {
    private val mutableState = MutableStateFlow(CameraRuntimeState())
    val state = mutableState.asStateFlow()

    @Volatile
    var previewView: PreviewView? = null

    fun update(transform: (CameraRuntimeState) -> CameraRuntimeState) {
        mutableState.value = transform(mutableState.value)
    }
}

class CameraForegroundService : LifecycleService(), CameraSignalingListener {
    private val sessions = mutableMapOf<String, WebRtcCameraSession>()
    private lateinit var api: BeaconApi
    private lateinit var credential: String
    private var media: CameraMediaSource? = null
    private var signaling: CameraSignalingClient? = null
    private var signalingOnline = false
    private var initializing = false
    private var cameras: List<RegisteredCameraSource> = emptyList()
    private var selectedCamera: RegisteredCameraSource? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        val pendingIntent =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val notification =
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setContentTitle("Beacon camera is active")
                .setContentText("Online and ready for authorized viewers")
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setSilent(true)
                .build()
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            } else {
                0
            },
        )
        CameraRuntime.previewView = PreviewView(applicationContext)
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        CameraRuntime.update {
            it.copy(
                batteryOptimizationRestricted =
                    !powerManager.isIgnoringBatteryOptimizations(packageName),
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) {
            stopCamera()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_SELECT_CAMERA) {
            selectCamera(intent.getStringExtra(EXTRA_CAMERA_ID))
            return START_STICKY
        }
        val storedCredential = CredentialStore(this).read()
        if (storedCredential == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if ((::credential.isInitialized && signaling != null) || initializing) {
            return START_STICKY
        }
        credential = storedCredential
        api = BeaconApi(BuildConfig.BEACON_API_URL)
        CameraRuntime.update {
            it.copy(
                cameraEnabled = true,
                device = DeviceLifecycle.Online,
                diagnostic = "Connecting to Beacon",
            )
        }
        initializing = true
        lifecycleScope.launch {
            val synchronization =
                withContext(Dispatchers.IO) {
                    runCatching { api.syncCameras(credential, enumerateCameraSources()) }
                }
            if (synchronization.exceptionOrNull() is AuthorizationLostException) {
                initializing = false
                CredentialStore(this@CameraForegroundService).clear()
                CameraRuntime.update {
                    it.copy(
                        cameraEnabled = false,
                        device = DeviceLifecycle.Error,
                        diagnostic = "Credential revoked",
                    )
                }
                stopCamera()
                return@launch
            }
            val synchronized = synchronization.getOrNull()
            if (synchronized == null) {
                initializing = false
                CameraRuntime.update {
                    it.copy(
                        device = DeviceLifecycle.Offline,
                        diagnostic = "Backend unavailable; retrying camera registration",
                    )
                }
                lifecycleScope.launch {
                    delay(2_000)
                    startRuntimeAgain()
                }
                return@launch
            }
            cameras =
                synchronized.map {
                    RegisteredCameraSource(it.id, it.sourceKey, it.name, it.facing)
                }
            val preferred =
                getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                    .getString(SELECTED_CAMERA_ID, null)
            selectedCamera =
                cameras.find { it.id == preferred }
                    ?: cameras.find { it.facing == "rear" }
                    ?: cameras.first()
            CameraRuntime.update {
                it.copy(
                    cameras = cameras,
                    selectedCameraId = selectedCamera?.id,
                )
            }
            startSignaling()
            initializing = false
            while (true) {
                val accepted =
                    withContext(Dispatchers.IO) {
                        runCatching { api.heartbeat(credential) }.getOrNull()
                    }
                when (accepted) {
                    true -> Unit
                    false -> {
                        CredentialStore(this@CameraForegroundService).clear()
                        CameraRuntime.update {
                            it.copy(
                                cameraEnabled = false,
                                device = DeviceLifecycle.Error,
                                diagnostic = "Credential revoked",
                            )
                        }
                        stopCamera()
                        break
                    }
                    null -> {
                        signaling?.requestReconnect()
                        CameraRuntime.update {
                            it.copy(
                                device = DeviceLifecycle.Offline,
                                diagnostic = "Network unavailable; reconnecting",
                            )
                        }
                    }
                }
                delay(30_000)
            }
        }
        return START_STICKY
    }

    override fun onViewerReady(
        connectionId: String,
        iceServers: List<SignalingIceServer>,
        relayOnly: Boolean,
    ) {
        val firstViewer = sessions.isEmpty()
        sessions.remove(connectionId)?.close()
        val preview = CameraRuntime.previewView ?: PreviewView(applicationContext)
        val activeCamera = selectedCamera ?: return
        val sharedMedia =
            media
                ?: CameraMediaSource(this, this, preview, activeCamera.facing).also {
                    media = it
                }
        sessions[connectionId] =
            WebRtcCameraSession(
                sharedMedia,
                iceServers,
                relayOnly,
                connectionId,
                requireNotNull(signaling),
            ) { state ->
                if (state == StreamingState.Failed) closeViewer(connectionId)
                updateRuntime(state.name)
            }.also { it.start() }
        Log.i(LOG_TAG, "event=viewer_joined connectionId=$connectionId")
        if (firstViewer) Log.i(LOG_TAG, "event=capture_started")
        updateRuntime("Viewer connecting")
    }

    override fun onAnswer(connectionId: String, sdp: String) {
        sessions[connectionId]?.setAnswer(sdp)
    }

    override fun onIce(connectionId: String, candidate: IceCandidate) {
        sessions[connectionId]?.addIce(candidate)
    }

    override fun onPeerLeft(connectionId: String) {
        closeViewer(connectionId)
    }

    override fun onSignalingState(state: StreamingState) {
        signalingOnline = state == StreamingState.Ready || state == StreamingState.Connected
        if (
            state == StreamingState.Failed ||
                state == StreamingState.Offline ||
                state == StreamingState.Reconnecting
        ) {
            sessions.keys.toList().forEach(::closeViewer)
        }
        updateRuntime(state.name)
    }

    override fun onRetryAttempt(attempt: Int) {
        CameraRuntime.update { it.copy(retryAttempt = attempt) }
    }

    override fun onSourceSwitch(cameraId: String) {
        selectCamera(cameraId)
    }

    override fun onDestroy() {
        signaling?.disconnect(sessions.keys)
        signaling = null
        sessions.values.forEach(WebRtcCameraSession::close)
        sessions.clear()
        media?.close()
        media = null
        CameraRuntime.previewView = null
        CameraRuntime.update { CameraRuntimeState() }
        super.onDestroy()
    }

    private fun closeViewer(connectionId: String) {
        val removed = sessions.remove(connectionId)
        removed?.close()
        if (removed != null) {
            Log.i(LOG_TAG, "event=viewer_left connectionId=$connectionId")
            if (sessions.isEmpty()) Log.i(LOG_TAG, "event=capture_stopped")
        }
        updateRuntime("Viewer disconnected")
    }

    private fun updateRuntime(reason: String) {
        CameraRuntime.update {
            it.copy(
                activeViewers = sessions.size,
                device = deviceStateFor(signalingOnline, sessions.size, enabled = true),
                diagnostic = reason,
            )
        }
    }

    private fun stopCamera() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun enumerateCameraSources(): List<BeaconApi.CameraSource> {
        val manager = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        return manager.cameraIdList.mapNotNull { cameraId ->
            val characteristics = manager.getCameraCharacteristics(cameraId)
            when (characteristics.get(CameraCharacteristics.LENS_FACING)) {
                CameraCharacteristics.LENS_FACING_FRONT ->
                    BeaconApi.CameraSource("", "android:$cameraId", "Front camera", "front")
                CameraCharacteristics.LENS_FACING_BACK ->
                    BeaconApi.CameraSource("", "android:$cameraId", "Rear camera", "rear")
                CameraCharacteristics.LENS_FACING_EXTERNAL ->
                    BeaconApi.CameraSource("", "android:$cameraId", "External camera", "external")
                else -> null
            }
        }.ifEmpty {
            listOf(BeaconApi.CameraSource("", "android:default", "Camera", "unknown"))
        }
    }

    private fun startSignaling() {
        val camera = selectedCamera ?: return
        signaling =
            CameraSignalingClient(
                this,
                BuildConfig.BEACON_API_URL,
                camera.id,
                credential,
                this,
            ).also { it.connect() }
    }

    private fun selectCamera(cameraId: String?) {
        val next = cameras.find { it.id == cameraId } ?: return
        if (next.id == selectedCamera?.id) return
        signaling?.disconnect(sessions.keys)
        signaling = null
        sessions.values.forEach(WebRtcCameraSession::close)
        sessions.clear()
        media?.close()
        media = null
        selectedCamera = next
        Log.i(LOG_TAG, "event=camera_source_changed cameraId=${next.id}")
        getSharedPreferences(PREFERENCES, MODE_PRIVATE)
            .edit()
            .putString(SELECTED_CAMERA_ID, next.id)
            .apply()
        CameraRuntime.update {
            it.copy(
                activeViewers = 0,
                selectedCameraId = next.id,
                sourceLifecycle = CameraSourceLifecycle.Switching,
                diagnostic = "Switching camera source",
            )
        }
        startSignaling()
    }

    private fun startRuntimeAgain() {
        if (signaling == null && !initializing) {
            onStartCommand(Intent(this, CameraForegroundService::class.java), 0, 0)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Camera status",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Visible status while Beacon operates as a camera"
            },
        )
    }

    companion object {
        private const val CHANNEL_ID = "beacon_camera_status"
        private const val NOTIFICATION_ID = 1001
        private const val ACTION_STOP = "com.beaconsecureview.camera.STOP"
        private const val ACTION_SELECT_CAMERA = "com.beaconsecureview.camera.SELECT_CAMERA"
        private const val EXTRA_CAMERA_ID = "camera_id"
        private const val PREFERENCES = "beacon_camera_runtime"
        private const val SELECTED_CAMERA_ID = "selected_camera_id"
        private const val LOG_TAG = "BeaconLifecycle"

        fun start(context: Context) {
            androidx.core.content.ContextCompat.startForegroundService(
                context,
                Intent(context, CameraForegroundService::class.java),
            )
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, CameraForegroundService::class.java).setAction(ACTION_STOP),
            )
        }

        fun selectCamera(context: Context, cameraId: String) {
            context.startService(
                Intent(context, CameraForegroundService::class.java)
                    .setAction(ACTION_SELECT_CAMERA)
                    .putExtra(EXTRA_CAMERA_ID, cameraId),
            )
        }
    }
}
