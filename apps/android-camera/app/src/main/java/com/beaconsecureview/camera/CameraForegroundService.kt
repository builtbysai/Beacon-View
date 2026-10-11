package com.beaconsecureview.camera

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.os.BatteryManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.camera.view.PreviewView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.webrtc.IceCandidate
import java.io.File

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
    private var captureGeneration = 0
    private lateinit var privacyGate: PrivacyGate
    private var startupBlockedByMissingCameraPermission = false
    @Volatile
    private var motionSettings = emptyMap<String, MotionSettings>()

    override fun onCreate() {
        super.onCreate()
        // Clips this camera recorded are plaintext until encrypted. They use their own prefix so playback
        // cleanup cannot delete one being uploaded (V44), and any a crash left behind are removed here.
        deleteStaleCacheFiles(cacheDir, "beacon-rec-", olderThanMs = 10 * 60_000L)
        if (!hasCameraPermission()) {
            startupBlockedByMissingCameraPermission = true
            CameraRuntime.update {
                it.copy(
                    cameraEnabled = false,
                    sourceLifecycle = CameraSourceLifecycle.Disabled,
                    diagnostic = "Camera permission is required",
                )
            }
            // Android may restart this START_STICKY service immediately after the user
            // revokes camera permission. Declaring a camera foreground-service type in
            // that state throws SecurityException before the Activity can request access.
            stopSelf()
            return
        }
        privacyGate = PrivacyGate(
            getSharedPreferences(PREFERENCES, MODE_PRIVATE).getBoolean(PENDING_PRIVACY_PAUSE, false),
        )
        CameraRuntime.update {
            it.copy(privacyMode = privacyGate.privacyEnabled, privacySyncPending = privacyGate.pendingPause)
        }
        createNotificationChannel()
        showForegroundStatus(captureActive = !privacyGate.privacyEnabled)
        CameraRuntime.previewView = createPreviewView()
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        CameraRuntime.update {
            it.copy(
                batteryOptimizationRestricted =
                    !powerManager.isIgnoringBatteryOptimizations(packageName),
            )
        }
    }

    private fun showForegroundStatus(
        captureActive: Boolean,
        recordingActive: Boolean = CameraRuntime.state.value.recordingActive,
    ) {
        val pendingIntent =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val microphoneEnabled = captureActive && hasMicrophonePermission()
        val pauseIntent =
            PendingIntent.getService(
                this,
                1,
                Intent(this, CameraForegroundService::class.java)
                    .setAction(ACTION_SET_PRIVACY)
                    .putExtra(EXTRA_PRIVACY_ENABLED, true),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val notification =
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setContentTitle(
                    if (!captureActive) {
                        "Beacon privacy is on"
                    } else if (recordingActive) {
                        "Beacon is recording a clip"
                    } else if (microphoneEnabled) {
                        "Beacon camera and microphone are active"
                    } else {
                        "Beacon camera is active"
                    },
                )
                .setContentText(
                    if (!captureActive) {
                        "Camera and microphone are off"
                    } else if (recordingActive) {
                        "Recording is visible and stops automatically"
                    } else {
                        "Visible and ready for authorized live viewers"
                    },
                )
                .setContentIntent(pendingIntent)
                .apply {
                    if (captureActive) {
                        addAction(
                            android.R.drawable.ic_media_pause,
                            "Pause camera",
                            pauseIntent,
                        )
                    }
                }
                .setOngoing(true)
                .setSilent(true)
                .build()
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                foregroundServiceType(captureActive, microphoneEnabled)
            } else {
                0
            },
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (startupBlockedByMissingCameraPermission) return START_NOT_STICKY
        if (intent?.action == ACTION_SELECT_CAMERA) {
            selectCamera(intent.getStringExtra(EXTRA_CAMERA_ID))
            return START_STICKY
        }
        if (intent?.action == ACTION_SET_PRIVACY) {
            setLocalPrivacy(intent.getBooleanExtra(EXTRA_PRIVACY_ENABLED, true))
            return START_STICKY
        }
        val storedCredential = CredentialStore(this).read()
        if (storedCredential == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (::credential.isInitialized && signaling != null) {
            if (!CameraRuntime.state.value.privacyMode && media == null) startLocalPreview()
            return START_STICKY
        }
        if (initializing) {
            return START_STICKY
        }
        credential = storedCredential
        api = BeaconApi(BuildConfig.BEACON_API_URL)
        CameraRuntime.update {
            it.copy(
                cameraEnabled = !privacyGate.privacyEnabled,
                device = DeviceLifecycle.Online,
                diagnostic = "Connecting to Beacon",
                pairingRequired = false,
            )
        }
        initializing = true
        lifecycleScope.launch {
            withContext(Dispatchers.IO) { rotateCredentialIfDue() }
            val privacyVersion = privacyGate.version
            val synchronization =
                withContext(Dispatchers.IO) {
                    runCatching { api.syncCameras(credential, enumerateCameraSources()) }
                }
            if (synchronization.exceptionOrNull() is AuthorizationLostException && rejections.reject()) {
                initializing = false
                requirePairing()
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
                synchronized.cameras.map {
                    RegisteredCameraSource(it.id, it.sourceKey, it.name, it.facing)
                }
            if (cameras.isEmpty()) {
                initializing = false
                selectedCamera = null
                CameraRuntime.update {
                    it.copy(
                        cameraEnabled = false,
                        cameras = emptyList(),
                        selectedCameraId = null,
                        sourceLifecycle = CameraSourceLifecycle.Disabled,
                        diagnostic = "No camera sources are shared",
                    )
                }
                return@launch
            }
            val preferred =
                getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                    .getString(SELECTED_CAMERA_ID, null)
            selectedCamera =
                cameras.find { it.id == preferred }
                    ?: cameras.find { it.facing == "rear" }
                    ?: cameras.first()
            privacyGate.receiveSnapshot(synchronized.privacyMode, privacyVersion)
            CameraRuntime.update {
                it.copy(
                    cameras = cameras,
                    selectedCameraId = selectedCamera?.id,
                    sourceLifecycle =
                        if (privacyGate.privacyEnabled) {
                            CameraSourceLifecycle.Disabled
                        } else {
                            CameraSourceLifecycle.Available
                        },
                    privacyMode = privacyGate.privacyEnabled,
                    privacySyncPending = privacyGate.pendingPause,
                )
            }
            applyPrivacyState()
            startSignaling()
            initializing = false
            while (true) {
                if (privacyGate.pendingPause && !privacyGate.requestInFlight) setLocalPrivacy(true)
                val accepted =
                    withContext(Dispatchers.IO) {
                        runCatching {
                            api.heartbeat(
                                credential,
                                batteryPercent(),
                                batteryCharging(),
                                ThermalStatus.current(getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager),
                            )
                        }.getOrNull()
                    }
                when (accepted) {
                    true -> {
                        rejections.accept()
                        val settings = withContext(Dispatchers.IO) {
                            runCatching { api.motionSettings(credential) }
                        }
                        if (settings.exceptionOrNull() is AuthorizationLostException) {
                            if (rejections.reject()) {
                                requirePairing()
                                break
                            }
                        }
                        settings.onSuccess { motionSettings = it }
                            .onFailure { Log.w(LOG_TAG, "event=motion_settings_sync_failed") }
                    }
                    false -> {
                        if (rejections.reject()) {
                            requirePairing()
                            break
                        }
                        signaling?.requestReconnect()
                        CameraRuntime.update {
                            it.copy(diagnostic = "Checking this device's connection")
                        }
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
                // A camera that never restarts still swaps its credential about monthly. Wait for a moment with
                // no live viewers, because the signaling connection is rebuilt with the new credential (V22).
                if (SystemClock.elapsedRealtime() - lastRotationCheck > ROTATION_CHECK_INTERVAL_MS && sessions.isEmpty()) {
                    lastRotationCheck = SystemClock.elapsedRealtime()
                    if (withContext(Dispatchers.IO) { rotateCredentialIfDue() }) {
                        signaling?.disconnect(emptyList())
                        signaling = null
                        startSignaling()
                    }
                }
                delay(30_000)
            }
        }
        return START_STICKY
    }

    private var lastRotationCheck = SystemClock.elapsedRealtime()

    /** Saves a replacement credential before using it; any failure leaves the working one in place. */
    private fun rotateCredentialIfDue(): Boolean {
        val replacement = runCatching { api.rotateCredential(credential) }.getOrNull() ?: return false
        return runCatching {
            CredentialStore(this).save(replacement)
            credential = replacement
            true
        }.getOrDefault(false)
    }

    private fun batteryPercent(): Int? =
        (getSystemService(Context.BATTERY_SERVICE) as BatteryManager)
            .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            .takeIf { it in 0..100 }

    private fun batteryCharging(): Boolean? {
        val intent = registerReceiver(
            null,
            android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED),
        ) ?: return null
        return intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1) in
            listOf(BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL)
    }

    override fun onViewerReady(
        connectionId: String,
        iceServers: List<SignalingIceServer>,
        relayOnly: Boolean,
        canListen: Boolean,
    ) {
        val firstViewer = sessions.isEmpty()
        sessions.remove(connectionId)?.close()
        val sharedMedia = media ?: startLocalPreview() ?: return
        sessions[connectionId] =
            WebRtcCameraSession(
                sharedMedia,
                iceServers,
                relayOnly,
                connectionId,
                requireNotNull(signaling),
                canListen,
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

    override fun onIceRestart(connectionId: String, iceServers: List<SignalingIceServer>) {
        sessions[connectionId]?.restartIce(iceServers)
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

    override fun onSourcesChanged() {
        restart(this)
    }

    override fun onPrivacyMode(enabled: Boolean) {
        privacyGate.receiveRemote(enabled)
        applyPrivacyState()
    }

    @android.annotation.SuppressLint("ApplySharedPref")
    private fun applyPrivacyState() {
        val enabled = privacyGate.privacyEnabled
        val changed = enabled != CameraRuntime.state.value.privacyMode
        if (enabled || changed) {
            sessions.keys.toList().forEach(::closeViewer)
            captureGeneration += 1
            media?.close()
            media = null
        }
        // Persist after capture stops, before returning from the local action.
        val preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
        if (
            preferences.getBoolean(PENDING_PRIVACY_PAUSE, false) != privacyGate.pendingPause &&
                !preferences.edit().putBoolean(PENDING_PRIVACY_PAUSE, privacyGate.pendingPause).commit()
        ) {
            Log.w(LOG_TAG, "event=privacy_intent_persistence_failed")
        }
        CameraRuntime.update {
            it.copy(
                activeViewers = sessions.size,
                cameraEnabled = !enabled && media != null,
                device = if (enabled) DeviceLifecycle.Disabled else DeviceLifecycle.Idle,
                diagnostic =
                    when {
                        privacyGate.pendingPause -> "Camera and microphone are off; waiting to sync privacy"
                        enabled -> "Privacy mode is on"
                        else -> "Ready for viewers"
                    },
                privacyMode = enabled,
                privacyChangePending = privacyGate.requestInFlight,
                privacySyncPending = privacyGate.pendingPause,
            )
        }
        if (!enabled) startLocalPreview()
        showForegroundStatus(captureActive = !enabled)
    }

    override fun onTalkState(connectionId: String, active: Boolean) {
        sessions[connectionId]?.setTalkEnabled(active)
    }

    override fun onRecordingRequested(recordingId: String) {
        startRequestedRecording(captureGeneration, recordingId, MANUAL_CLIP_MAX_DURATION_MS)
    }

    override fun onAuthorizationLost() {
        if (rejections.reject()) requirePairing() else signaling?.requestReconnect()
    }

    override fun onDestroy() {
        signaling?.disconnect(sessions.keys)
        signaling = null
        sessions.values.forEach(WebRtcCameraSession::close)
        sessions.clear()
        captureGeneration += 1
        media?.close()
        media = null
        CameraRuntime.previewView = null
        CameraRuntime.update { previous ->
            if (previous.pairingRequired) {
                CameraRuntimeState(
                    device = DeviceLifecycle.AuthenticationRequired,
                    diagnostic = "Pair this device to continue",
                    pairingRequired = true,
                )
            } else {
                CameraRuntimeState()
            }
        }
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
                device = deviceStateFor(signalingOnline, sessions.size, enabled = !privacyGate.privacyEnabled),
                diagnostic = if (privacyGate.privacyEnabled) it.diagnostic else reason,
            )
        }
    }

    private val rejections = RejectedCredentialTracker()

    private fun requirePairing() {
        CredentialStore(this).clear()
        CameraRuntime.update {
            it.copy(
                cameraEnabled = false,
                device = DeviceLifecycle.AuthenticationRequired,
                diagnostic = "Pair this device to continue",
                pairingRequired = true,
            )
        }
        stopCamera()
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

    private fun startLocalPreview(): CameraMediaSource? {
        if (privacyGate.privacyEnabled) return null
        media?.let { return it }
        val activeCamera = selectedCamera ?: return null
        val preview = CameraRuntime.previewView ?: createPreviewView().also {
            CameraRuntime.previewView = it
        }
        CameraRuntime.update { state ->
            state.copy(
                cameraEnabled = false,
                sourceLifecycle = CameraSourceLifecycle.Switching,
                diagnostic = "Starting camera",
            )
        }
        val generation = ++captureGeneration
        val created = CameraMediaSource(
            this,
            this,
            preview,
            activeCamera.facing,
            shouldCaptureAudio(hasMicrophonePermission()),
            { started -> handleCaptureStart(generation, started) },
            { confidence -> reportMotion(generation, activeCamera.id, confidence) },
            { motionSettings[activeCamera.id] ?: MotionSettings(enabled = false) },
        )
        media = created
        lifecycleScope.launch {
            delay(5_000)
            if (generation == captureGeneration && !CameraRuntime.state.value.cameraEnabled) {
                handleCaptureStart(generation, false)
            }
        }
        return created
    }

    private fun createPreviewView(): PreviewView =
        PreviewView(applicationContext).apply {
            // Camera Mode is scrollable on compact displays. TextureView-backed preview rendering
            // respects Compose clipping and translation; the default SurfaceView can paint over
            // status and privacy controls when the column moves.
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }

    private fun reportMotion(generation: Int, cameraId: String, confidence: Float) {
        if (generation != captureGeneration || CameraRuntime.state.value.privacyMode) return
        lifecycleScope.launch(Dispatchers.IO) {
            val recordingId =
                runCatching { api.reportMotion(credential, cameraId, confidence) }
                    .onFailure { error ->
                        if (error is AuthorizationLostException) {
                            if (rejections.reject()) withContext(Dispatchers.Main) { requirePairing() }
                        } else {
                            Log.w(LOG_TAG, "event=motion_report_failed")
                        }
                    }
                    .getOrNull()
            if (recordingId != null) {
                withContext(Dispatchers.Main) {
                    startRequestedRecording(generation, recordingId, MOTION_CLIP_MAX_DURATION_MS)
                }
            }
        }
    }

    /** Best-effort clip capture that reports terminal failures without
     * interrupting the live stream this service may already be sending. */
    private fun startRequestedRecording(
        generation: Int,
        recordingId: String,
        maxDurationMs: Long,
    ) {
        if (generation != captureGeneration) {
            reportRecordingFailure(recordingId, "abandoned")
            return
        }
        val activeMedia = media
        if (activeMedia == null) {
            reportRecordingFailure(recordingId, "capture_failed")
            return
        }
        val outputFile = File(cacheDir, "beacon-rec-$recordingId.mp4")
        CameraRuntime.update {
            it.copy(recordingActive = true, diagnostic = "Recording a short clip")
        }
        showForegroundStatus(captureActive = true, recordingActive = true)
        val started =
            activeMedia.startClipRecording(
                outputFile,
                maxDurationMs,
                shouldCaptureAudio(hasMicrophonePermission()),
            ) { durationMs, success ->
                CameraRuntime.update {
                    it.copy(
                        recordingActive = false,
                        diagnostic = if (success) "Encrypting and uploading clip" else "Clip recording failed",
                    )
                }
                showForegroundStatus(captureActive = !privacyGate.privacyEnabled, recordingActive = false)
                lifecycleScope.launch(Dispatchers.IO) {
                    if (generation != captureGeneration) {
                        outputFile.delete()
                        reportRecordingFailure(recordingId, "abandoned")
                        return@launch
                    }
                    if (success) {
                        uploadRequestedClip(recordingId, outputFile, durationMs)
                    } else {
                        outputFile.delete()
                        Log.w(LOG_TAG, "event=motion_clip_capture_failed")
                        reportRecordingFailure(recordingId, "capture_failed")
                    }
                }
            }
        if (!started) {
            CameraRuntime.update {
                it.copy(recordingActive = false, diagnostic = "Clip recording is unavailable")
            }
            showForegroundStatus(captureActive = !privacyGate.privacyEnabled, recordingActive = false)
            outputFile.delete()
            reportRecordingFailure(recordingId, "capture_failed")
        }
    }

    private suspend fun uploadRequestedClip(recordingId: String, file: File, durationMs: Long) {
        val encryptedFile = File(cacheDir, "beacon-rec-$recordingId.encrypted")
        runCatching {
            val encrypted = encryptClip(file, encryptedFile)
            file.delete()
            val checksum = sha256Hex(encrypted.file)
            // Each step is retried on its own (V59): the encrypted file stays until the end, and the
            // Drive upload session Beacon opened accepts the same bytes again after a failed PUT.
            val uploadUrl =
                retryTransient {
                    api.beginRecordingUpload(
                        credential,
                        recordingId,
                        encrypted.file.length(),
                        checksum,
                        durationMs.coerceIn(1_000, 600_000),
                        "video/mp4",
                        encrypted.dataKey,
                        encrypted.iv,
                    )
                }
            val providerFileId = retryTransient { uploadClipToDrive(uploadUrl, encrypted.file) }
            retryTransient { api.completeRecording(credential, recordingId, providerFileId) }
            Log.i(LOG_TAG, "event=clip_uploaded")
        }.onFailure { error ->
            Log.w(LOG_TAG, "event=motion_clip_upload_failed")
            runCatching { api.failRecording(credential, recordingId, "upload_failed") }
            if (error is AuthorizationLostException) {
                withContext(Dispatchers.Main) { requirePairing() }
            }
        }
        file.delete()
        encryptedFile.delete()
    }

    private fun reportRecordingFailure(recordingId: String, reason: String) {
        lifecycleScope.launch(Dispatchers.IO) {
            runCatching { api.failRecording(credential, recordingId, reason) }
                .onFailure { error ->
                    Log.w(LOG_TAG, "event=recording_failure_report_failed")
                    if (error is AuthorizationLostException) {
                        withContext(Dispatchers.Main) { requirePairing() }
                    }
                }
        }
    }

    /** Tells the server whether this phone can record clips, so a camera that never can is not silently set up to (V72). */
    private fun reportClipCapability() {
        val available = media?.clipRecordingAvailable ?: return
        lifecycleScope.launch(Dispatchers.IO) {
            runCatching { api.syncCameras(credential, enumerateCameraSources(), available) }
                .onFailure { Log.w(LOG_TAG, "event=clip_capability_report_failed") }
        }
    }

    private fun handleCaptureStart(generation: Int, started: Boolean) {
        if (generation != captureGeneration) return
        if (started) {
            CameraRuntime.update { state ->
                state.copy(
                    cameraEnabled = true,
                    sourceLifecycle = CameraSourceLifecycle.Available,
                    diagnostic =
                        if (signalingOnline) "Live and ready" else "Camera ready; connecting",
                )
            }
            reportClipCapability()
            return
        }
        captureGeneration += 1
        val failedMedia = media
        media = null
        failedMedia?.close()
        CameraRuntime.update { state ->
            state.copy(
                cameraEnabled = false,
                sourceLifecycle = CameraSourceLifecycle.Disabled,
                diagnostic = "Open Beacon to resume camera",
            )
        }
    }

    private fun selectCamera(cameraId: String?) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            ContextCompat.getMainExecutor(this).execute { selectCamera(cameraId) }
            return
        }
        val next = cameras.find { it.id == cameraId } ?: return
        if (next.id == selectedCamera?.id) return
        signaling?.disconnect(sessions.keys)
        signaling = null
        sessions.values.forEach(WebRtcCameraSession::close)
        sessions.clear()
        captureGeneration += 1
        val generationForSourceSwitch = captureGeneration
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
        // CameraX unbinds asynchronously and there is no callback to await the old
        // lens's Camera2 session actually closing on the HAL -- only a best-effort
        // handoff delay. 250ms wasn't consistently enough on real hardware; 500ms
        // plus CameraXVideoCapturer's own bounded bind-retry covers the remainder.
        lifecycleScope.launch {
            delay(500)
            if (captureGeneration == generationForSourceSwitch &&
                !CameraRuntime.state.value.privacyMode &&
                selectedCamera?.id == next.id
            ) {
                startLocalPreview()
                startSignaling()
            }
        }
    }

    private fun startRuntimeAgain() {
        if (signaling == null && !initializing) {
            onStartCommand(Intent(this, CameraForegroundService::class.java), 0, 0)
        }
    }

    private fun setLocalPrivacy(enabled: Boolean) {
        val change = privacyGate.begin(enabled) ?: return
        applyPrivacyState()
        if (!::credential.isInitialized || !::api.isInitialized) {
            privacyGate.fail(change)
            applyPrivacyState()
            return
        }
        lifecycleScope.launch {
            val result =
                withContext(Dispatchers.IO) {
                    runCatching { api.setPrivacyMode(credential, enabled) }
                }
            result.onSuccess {
                if (privacyGate.complete(change, it)) applyPrivacyState()
            }.onFailure { error ->
                if (!privacyGate.fail(change)) return@onFailure
                applyPrivacyState()
                if (error is AuthorizationLostException) {
                    requirePairing()
                } else {
                    CameraRuntime.update {
                        it.copy(
                            diagnostic =
                                if (privacyGate.privacyEnabled) {
                                    "Camera and microphone remain off. Check the connection to sync privacy or try Resume again."
                                } else {
                                    "Privacy could not be synchronized. Check the connection and try again."
                                },
                        )
                    }
                }
            }
        }
    }

    private fun hasMicrophonePermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    private fun hasCameraPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED

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
        private const val ROTATION_CHECK_INTERVAL_MS = 24L * 60 * 60 * 1000
        private const val CHANNEL_ID = "beacon_camera_status"
        private const val NOTIFICATION_ID = 1001
        private const val ACTION_SELECT_CAMERA = "com.beaconsecureview.camera.SELECT_CAMERA"
        private const val ACTION_SET_PRIVACY = "com.beaconsecureview.camera.SET_PRIVACY"
        private const val EXTRA_CAMERA_ID = "camera_id"
        private const val EXTRA_PRIVACY_ENABLED = "privacy_enabled"
        private const val PREFERENCES = "beacon_camera_runtime"
        private const val SELECTED_CAMERA_ID = "selected_camera_id"
        private const val PENDING_PRIVACY_PAUSE = "pending_privacy_pause"
        private const val LOG_TAG = "BeaconLifecycle"
        private const val MOTION_CLIP_MAX_DURATION_MS = 20_000L
        private const val MANUAL_CLIP_MAX_DURATION_MS = 15_000L

        fun start(context: Context) {
            androidx.core.content.ContextCompat.startForegroundService(
                context,
                Intent(context, CameraForegroundService::class.java),
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CameraForegroundService::class.java))
        }

        fun selectCamera(context: Context, cameraId: String) {
            context.startService(
                Intent(context, CameraForegroundService::class.java)
                    .setAction(ACTION_SELECT_CAMERA)
                    .putExtra(EXTRA_CAMERA_ID, cameraId),
            )
        }

        fun setPrivacyMode(context: Context, enabled: Boolean) {
            context.startService(
                Intent(context, CameraForegroundService::class.java)
                    .setAction(ACTION_SET_PRIVACY)
                    .putExtra(EXTRA_PRIVACY_ENABLED, enabled),
            )
        }


        fun restart(context: Context) {
            context.stopService(Intent(context, CameraForegroundService::class.java))
            start(context)
        }
    }
}

internal fun foregroundServiceType(captureActive: Boolean, microphoneEnabled: Boolean): Int =
    ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
        if (captureActive && microphoneEnabled) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        } else {
            0
        }
