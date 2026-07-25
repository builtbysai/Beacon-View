package com.beaconsecureview.camera

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
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
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) {
            stopCamera()
            return START_NOT_STICKY
        }
        val storedCredential = CredentialStore(this).read()
        if (storedCredential == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (::credential.isInitialized && signaling != null) return START_STICKY
        credential = storedCredential
        api = BeaconApi(BuildConfig.BEACON_API_URL)
        CameraRuntime.update {
            it.copy(
                cameraEnabled = true,
                device = DeviceLifecycle.Online,
                diagnostic = "Connecting to Beacon",
            )
        }
        signaling =
            CameraSignalingClient(
                this,
                BuildConfig.BEACON_API_URL,
                credential,
                this,
            ).also { it.connect() }
        lifecycleScope.launch {
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
                    null ->
                        CameraRuntime.update {
                            it.copy(
                                device = DeviceLifecycle.Offline,
                                diagnostic = "Network unavailable; reconnecting",
                            )
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
        sessions.remove(connectionId)?.close()
        val preview = CameraRuntime.previewView ?: PreviewView(applicationContext)
        val sharedMedia =
            media
                ?: CameraMediaSource(this, this, preview).also {
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
        sessions.remove(connectionId)?.close()
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
    }
}
