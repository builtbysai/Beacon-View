package com.beaconsecureview.camera

import android.Manifest
import android.content.pm.PackageManager
import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.VolumeOff
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.Cameraswitch
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.FiberManualRecord
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.PictureInPictureAlt
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.text.font.FontWeight
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.webrtc.SurfaceViewRenderer

@Composable
internal fun AndroidLiveView(
    camera: BeaconApi.MonitorCamera,
    sessionToken: String,
    onBack: () -> Unit,
    onDevice: () -> Unit,
    onFlip: (() -> Unit)?,
    flipLabel: String?,
    onAuthorizationLost: () -> Unit,
    canRecord: Boolean,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var lifecycleStarted by remember {
        mutableStateOf(lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
    }
    var viewerGeneration by remember(camera.id) { mutableStateOf(0) }
    var reconnectAttempt by remember(camera.id) { mutableStateOf(0) }
    var canListen by remember(camera.id) { mutableStateOf(false) }
    var listening by remember(camera.id) { mutableStateOf(false) }
    var canTalk by remember(camera.id) { mutableStateOf(false) }
    var talkState by remember(camera.id) { mutableStateOf(TalkState.Idle) }
    var quality by remember(camera.id) { mutableStateOf<StreamQuality?>(null) }
    var fullscreen by remember(camera.id) { mutableStateOf(false) }
    var statsOpen by remember(camera.id) { mutableStateOf(false) }
    var moreOpen by remember(camera.id) { mutableStateOf(false) }
    var viewerSession by remember(camera.id) { mutableStateOf<AndroidViewerSession?>(null) }
    var manualRecording by remember(camera.id) { mutableStateOf<BeaconApi.RecordingSummary?>(null) }
    var recordingBusy by remember(camera.id) { mutableStateOf(false) }
    var recordingElapsedSeconds by remember(camera.id) { mutableStateOf(0) }
    var recordingError by remember(camera.id) { mutableStateOf("") }
    var zoom by remember(camera.id) { mutableStateOf(ZoomState.Identity) }
    var snapshotNotice by remember(camera.id) { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val api = remember { BeaconApi(BuildConfig.BEACON_API_URL) }
    val renderer = remember(camera.id, viewerGeneration) { SurfaceViewRenderer(context) }
    var state by remember(camera.id) { mutableStateOf(StreamingState.Connecting) }
    val othersWatching = otherViewerCount(camera.viewerCount, state == StreamingState.Connected)
    // Picture-in-picture (ADR 0088): leaving the app floats a playing camera.
    val activity = remember(context) { context.findComponentActivity() }
    val canFloat = remember(context) { activity != null && pictureInPictureSupported(context) }
    val inPictureInPicture = rememberInPictureInPicture(activity)
    LivePictureInPictureEffect(activity, playing = state == StreamingState.Connected)

    DisposableEffect(lifecycleOwner) {
        val observer =
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_START -> {
                        if (!lifecycleStarted) viewerGeneration += 1
                        lifecycleStarted = true
                    }
                    Lifecycle.Event.ON_STOP -> lifecycleStarted = false
                    else -> Unit
                }
            }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val microphonePermissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) viewerSession?.startTalk() else talkState = TalkState.Unavailable
        }

    fun talkActive() =
        talkState == TalkState.Permission || talkState == TalkState.Connecting || talkState == TalkState.Speaking

    fun startTalk() {
        val granted =
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
        if (granted) {
            viewerSession?.startTalk()
        } else {
            microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // Tap to start and stop, or hold to talk only while pressed (ADR 0090).
    val pushToTalk =
        remember(camera.id) {
            PushToTalk(talking = { talkActive() }, start = { startTalk() }, stop = { viewerSession?.stopTalk() })
        }

    // Snapshots stay on this device (ADR 0090): the frame is read from the picture and saved to
    // Pictures/Beacon; nothing is sent anywhere.
    fun takeSnapshot() {
        snapshotNotice = ""
        SnapshotSaver.capture(renderer) { bitmap ->
            scope.launch {
                val saved =
                    withContext(Dispatchers.IO) { SnapshotSaver.save(context, bitmap, camera.name) }
                snapshotNotice =
                    if (saved) "Snapshot saved to Pictures/Beacon on this device."
                    else "The snapshot could not be saved."
            }
        }
    }

    LaunchedEffect(snapshotNotice) {
        if (snapshotNotice.isNotEmpty()) {
            delay(4_000)
            snapshotNotice = ""
        }
    }

    DisposableEffect(
        camera.id,
        sessionToken,
        viewerGeneration,
        lifecycleStarted,
    ) {
        canListen = false
        listening = false
        canTalk = false
        talkState = TalkState.Idle
        quality = null
        val viewer =
            if (shouldRunNativeViewer(lifecycleStarted)) {
                state = StreamingState.Connecting
                AndroidViewerSession(
                    context = context.applicationContext,
                    baseUrl = BuildConfig.BEACON_API_URL,
                    cameraId = camera.id,
                    sessionToken = sessionToken,
                    renderer = renderer,
                    onState = { state = it },
                    onCanListen = { allowed ->
                        canListen = allowed
                        if (!allowed) listening = false
                    },
                    onCanTalk = { allowed -> canTalk = allowed },
                    onTalkState = { talkState = it },
                    onQuality = { quality = it },
                    onAuthorizationLost = onAuthorizationLost,
                ).also {
                    viewerSession = it
                }
            } else {
                state = StreamingState.Ready
                null
            }
        onDispose {
            if (viewerSession === viewer) viewerSession = null
            viewer?.close()
        }
    }

    LaunchedEffect(camera.id, state) {
        if (state == StreamingState.Failed || state == StreamingState.Offline) {
            delay(retryDelayMillis(reconnectAttempt, Math.random()))
            reconnectAttempt += 1
            viewerGeneration += 1
        } else if (state == StreamingState.Connected && reconnectAttempt > 0) {
            delay(STABLE_CONNECTION_MILLIS)
            if (state == StreamingState.Connected) reconnectAttempt = 0
        }
    }

    LaunchedEffect(manualRecording?.id) {
        val requested = manualRecording ?: return@LaunchedEffect
        var current = requested
        recordingElapsedSeconds = 0
        while (current.status in setOf("requested", "recording", "uploading")) {
            delay(1_000)
            recordingElapsedSeconds += 1
            if (recordingElapsedSeconds % 2 != 0) continue
            val result =
                withContext(Dispatchers.IO) {
                    runCatching { api.recordings(sessionToken).recordings.firstOrNull { it.id == requested.id } }
                }
            val error = result.exceptionOrNull()
            if (error is AuthorizationLostException) {
                onAuthorizationLost()
                return@LaunchedEffect
            }
            result.getOrNull()?.let {
                current = it
                manualRecording = it
            }
            if (recordingElapsedSeconds >= 90) break
        }
        if (current.status == "available") {
            delay(6_000)
            if (manualRecording?.id == current.id) manualRecording = null
        }
    }

    fun requestRecording() {
        if (recordingBusy || manualRecording?.status in setOf("requested", "recording", "uploading")) return
        recordingBusy = true
        recordingError = ""
        scope.launch {
            val result =
                withContext(Dispatchers.IO) {
                    runCatching { api.requestManualRecording(sessionToken, camera.id) }
                }
            result.onSuccess { manualRecording = it }
                .onFailure {
                    if (it is AuthorizationLostException) onAuthorizationLost()
                    else recordingError = it.userFacingMessage("Recording could not be started.")
                }
            recordingBusy = false
        }
    }

    BackHandler(enabled = fullscreen) { fullscreen = false }

    // In the floating window: the video alone, no controls.
    if (inPictureInPicture) {
        Box(
            modifier =
                Modifier.fillMaxSize()
                    .background(Color.Black)
                    .semantics { contentDescription = "Live video from ${camera.name}" },
        ) {
            key(camera.id, viewerGeneration) {
                AndroidView(
                    factory = {
                        (renderer.parent as? ViewGroup)?.removeView(renderer)
                        renderer
                    },
                    update = {
                        it.scaleX = 1f
                        it.scaleY = 1f
                        it.translationX = 0f
                        it.translationY = 0f
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        return
    }

    if (fullscreen) {
        Box(
            modifier =
                Modifier.fillMaxSize()
                    .background(Color.Black)
                    .semantics { contentDescription = "Fullscreen live video from ${camera.name}" },
        ) {
            ZoomableVideo(
                renderer = renderer,
                generation = viewerGeneration,
                cameraKey = camera.id,
                zoom = zoom,
                onZoom = { zoom = it },
                description = "Fullscreen live video from ${camera.name}",
                modifier = Modifier.fillMaxSize(),
            )
            Column(
                modifier =
                    Modifier.align(Alignment.TopStart)
                        .padding(16.dp)
                        .background(Color.Black.copy(alpha = 0.62f), RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(camera.name, color = Color.White, style = MaterialTheme.typography.titleMedium)
                Text(
                    "$othersWatching other ${if (othersWatching == 1) "viewer" else "viewers"}",
                    color = Color.White,
                    style = MaterialTheme.typography.bodySmall,
                )
                if (canRecord && (recordingBusy || manualRecording != null)) {
                    ManualRecordingBadge(recordingBusy, manualRecording, recordingElapsedSeconds)
                }
            }
            Row(
                modifier =
                    Modifier.align(Alignment.BottomCenter)
                        .padding(16.dp)
                        .background(Color.Black.copy(alpha = 0.62f), RoundedCornerShape(16.dp))
                        .padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (canListen) {
                    OutlinedButton(
                        enabled = state == StreamingState.Connected,
                        onClick = {
                            listening = viewerSession?.setListening(!listening) ?: false
                        },
                    ) {
                        Icon(if (listening) Icons.AutoMirrored.Outlined.VolumeUp else Icons.AutoMirrored.Outlined.VolumeOff, null, modifier = Modifier.size(19.dp))
                        Text(if (listening) "Mute" else "Listen")
                    }
                }
                if (canTalk) {
                    TalkTouchTarget(
                        push = pushToTalk,
                        enabled = state == StreamingState.Connected || talkActive(),
                        description = if (talkState == TalkState.Speaking) "Stop talking" else "Talk. Hold to talk while pressed.",
                        modifier =
                            Modifier.height(40.dp)
                                .background(Color.White.copy(alpha = 0.14f), RoundedCornerShape(999.dp))
                                .padding(horizontal = 16.dp),
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                if (talkState == TalkState.Speaking) Icons.Outlined.MicOff else Icons.Outlined.Mic,
                                null,
                                tint = Color.White,
                                modifier = Modifier.size(19.dp),
                            )
                            Text(if (talkState == TalkState.Speaking) "Stop talking" else "Talk", color = Color.White)
                        }
                    }
                }
                OutlinedButton(enabled = state == StreamingState.Connected, onClick = ::takeSnapshot) {
                    Icon(Icons.Outlined.PhotoCamera, null, modifier = Modifier.size(19.dp))
                    Text("Snapshot", modifier = Modifier.padding(start = 6.dp))
                }
                if (canRecord) {
                    ManualRecordingControl(
                        enabled = state == StreamingState.Connected,
                        busy = recordingBusy,
                        recording = manualRecording,
                        elapsedSeconds = recordingElapsedSeconds,
                        onClick = ::requestRecording,
                    )
                }
                Button(onClick = { fullscreen = false }) {
                    Icon(Icons.Outlined.Fullscreen, null, modifier = Modifier.size(19.dp))
                    Text("Exit full screen", modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
        return
    }

    Box(modifier = Modifier.fillMaxSize().background(BeaconCanvas).safeDrawingPadding()) {
        ZoomableVideo(
            renderer = renderer,
            generation = viewerGeneration,
            cameraKey = camera.id,
            zoom = zoom,
            onZoom = { zoom = it },
            description = "Live video from ${camera.name}",
            modifier = Modifier.fillMaxSize(),
        )
        Row(
            modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(shape = RoundedCornerShape(999.dp), color = BeaconVideoOverlay) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to cameras", tint = Color.White)
                }
            }
            BeaconStatusPill(
                if (state == StreamingState.Connected) "LIVE" else "CONNECTING",
                if (state == StreamingState.Connected) BeaconDarkColorScheme.error else BeaconVideoMuted,
            )
            if (canRecord && (recordingBusy || manualRecording != null)) {
                ManualRecordingBadge(recordingBusy, manualRecording, recordingElapsedSeconds)
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(camera.deviceName, color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(camera.name, color = BeaconVideoMuted, style = MaterialTheme.typography.bodySmall)
            }
            IconButton(onClick = onDevice) {
                Icon(Icons.Outlined.Settings, "Camera settings", tint = Color.White)
            }
        }
        val overlay = liveOverlay(state, camera.privacyMode, reconnectAttempt)
        if (overlay != null) {
            Column(
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    overlay.title,
                    color = Color.White,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(overlay.detail, color = BeaconVideoMuted)
            }
        }
        Column(
            modifier =
                Modifier.align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, BeaconVideoOverlay)))
                    .navigationBarsPadding()
                    .padding(start = 16.dp, end = 16.dp, top = 28.dp, bottom = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (recordingError.isNotBlank()) {
                Text(recordingError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            if (snapshotNotice.isNotEmpty()) {
                Text(snapshotNotice, color = Color.White, style = MaterialTheme.typography.bodySmall)
            }
            if (talkState != TalkState.Idle) {
                Text(talkStatusText(talkState), color = Color.White, style = MaterialTheme.typography.bodySmall)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                if (canListen) {
                    Surface(shape = RoundedCornerShape(999.dp), color = BeaconVideoControl) {
                        IconButton(
                            enabled = state == StreamingState.Connected,
                            onClick = {
                                listening = viewerSession?.setListening(!listening) ?: false
                            },
                        ) {
                            Icon(if (listening) Icons.AutoMirrored.Outlined.VolumeUp else Icons.AutoMirrored.Outlined.VolumeOff, if (listening) "Mute" else "Listen", tint = Color.White)
                        }
                    }
                }
                if (canTalk) {
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = if (talkState == TalkState.Speaking) BeaconLive else BeaconVideoControl,
                    ) {
                        TalkTouchTarget(
                            push = pushToTalk,
                            enabled = state == StreamingState.Connected || talkActive(),
                            description =
                                if (talkState == TalkState.Speaking) {
                                    "Stop talking"
                                } else if (talkState == TalkState.Permission || talkState == TalkState.Connecting) {
                                    "Cancel talk"
                                } else {
                                    "Talk. Hold to talk while pressed."
                                },
                            modifier = Modifier.size(48.dp),
                        ) {
                            Icon(
                                if (talkState == TalkState.Speaking) Icons.Outlined.MicOff else Icons.Outlined.Mic,
                                null,
                                tint = Color.White,
                            )
                        }
                    }
                }
                if (canRecord) {
                    ManualRecordingControl(
                        enabled = state == StreamingState.Connected,
                        busy = recordingBusy,
                        recording = manualRecording,
                        elapsedSeconds = recordingElapsedSeconds,
                        onClick = ::requestRecording,
                    )
                }
                Surface(shape = RoundedCornerShape(999.dp), color = BeaconVideoControl) {
                    IconButton(onClick = { moreOpen = true }) {
                        Icon(Icons.Outlined.MoreVert, "More", tint = Color.White)
                    }
                }
            }
        }
    }
    if (moreOpen) {
        val connected = state == StreamingState.Connected
        LiveViewMoreSheet(
            actions =
                buildList {
                    add(LiveMoreAction(Icons.Outlined.PhotoCamera, "Save snapshot", enabled = connected, onClick = ::takeSnapshot))
                    if (onFlip != null) {
                        add(LiveMoreAction(Icons.Outlined.Cameraswitch, "Switch camera", value = flipLabel, onClick = onFlip))
                    }
                    if (canFloat) {
                        add(
                            LiveMoreAction(Icons.Outlined.PictureInPictureAlt, "Picture in picture", enabled = connected) {
                                if (activity == null || !enterLivePictureInPicture(activity)) {
                                    recordingError =
                                        "Picture-in-picture is turned off for Beacon. Turn it on in Android Settings → Apps → Beacon."
                                }
                            },
                        )
                    }
                    add(LiveMoreAction(Icons.Outlined.Fullscreen, "Full screen", enabled = connected) { fullscreen = true })
                    add(
                        LiveMoreAction(
                            Icons.Outlined.Visibility,
                            "Stream details",
                            value = if (othersWatching > 0) "$othersWatching ${if (othersWatching == 1) "viewer" else "viewers"}" else null,
                            keepOpen = true,
                        ) { statsOpen = !statsOpen },
                    )
                },
            onDismiss = { moreOpen = false },
            details =
                if (statsOpen) {
                    {
                        Text(
                            if (othersWatching == 0) "No one else is watching" else "Watching now",
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        if (state == StreamingState.Connected) {
                            Text("You", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        }
                        repeat(othersWatching) { index ->
                            Text(
                                "Household viewer ${index + 1}",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Text(
                            "Viewer names stay private in this live view.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.labelSmall,
                        )
                        quality?.let { StreamQualityFacts(it) }
                    }
                } else {
                    null
                },
        )
    }
}

/** Mirrors the PWA's `<dl className="stream-quality">` (LiveVideo.tsx) exactly:
 * Path, Video (fps/bitrate), Latency (RTT/jitter), Loss (lost packets). */
@Composable
private fun StreamQualityFacts(quality: StreamQuality) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        StreamQualityRow("Path", quality.path)
        StreamQualityRow("Video", "${quality.fps} fps · ${quality.bitrateKbps} kbps")
        StreamQualityRow("Latency", "${quality.rttMs} ms RTT · ${quality.jitterMs} ms jitter")
        StreamQualityRow("Loss", "${quality.lostPackets} packets")
    }
}

@Composable
private fun StreamQualityRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
        Text(value, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun ManualRecordingBadge(
    busy: Boolean,
    recording: BeaconApi.RecordingSummary?,
    elapsedSeconds: Int,
) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = if (recording?.status == "failed") MaterialTheme.colorScheme.error else BeaconVideoOverlay,
    ) {
        Text(
            manualRecordingLabel(busy, recording, elapsedSeconds),
            color = Color.White,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun ManualRecordingControl(
    enabled: Boolean,
    busy: Boolean,
    recording: BeaconApi.RecordingSummary?,
    elapsedSeconds: Int,
    onClick: () -> Unit,
) {
    val active = recording?.status in setOf("requested", "recording", "uploading")
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = if (active) BeaconLive else BeaconVideoControl,
    ) {
        IconButton(
            enabled = enabled && !busy && !active,
            onClick = onClick,
        ) {
            Icon(
                Icons.Outlined.FiberManualRecord,
                manualRecordingLabel(busy, recording, elapsedSeconds),
                tint = Color.White,
            )
        }
    }
}

internal fun manualRecordingLabel(
    busy: Boolean,
    recording: BeaconApi.RecordingSummary?,
    elapsedSeconds: Int,
): String =
    when {
        busy -> "Starting recording…"
        recording == null -> "Record a 15-second clip"
        recording.status == "requested" || recording.status == "recording" ->
            "Recording · Manual · ${elapsedSeconds.coerceAtMost(15).toString().padStart(2, '0')}s / 15s"
        recording.status == "uploading" -> "Encrypting and uploading recording"
        recording.status == "available" -> "Recording saved"
        recording.status == "failed" -> "Recording failed"
        else -> recordingStatusLabel(recording.status)
    }
