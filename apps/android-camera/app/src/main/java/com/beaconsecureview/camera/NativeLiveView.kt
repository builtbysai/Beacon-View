package com.beaconsecureview.camera

import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Cameraswitch
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import org.webrtc.SurfaceViewRenderer

@Composable
internal fun AndroidLiveView(
    camera: BeaconApi.MonitorCamera,
    sessionToken: String,
    onBack: () -> Unit,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
    onFlip: (() -> Unit)?,
    flipLabel: String?,
    onAuthorizationLost: () -> Unit,
    favorite: Boolean,
    onFavorite: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var lifecycleStarted by remember {
        mutableStateOf(lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
    }
    var viewerGeneration by remember(camera.id) { mutableStateOf(0) }
    var reconnectAttempt by remember(camera.id) { mutableStateOf(0) }
    var listening by remember(camera.id) { mutableStateOf(false) }
    var fullscreen by remember(camera.id) { mutableStateOf(false) }
    var viewerSession by remember(camera.id) { mutableStateOf<AndroidViewerSession?>(null) }
    val renderer = remember(camera.id, viewerGeneration) { SurfaceViewRenderer(context) }
    var state by remember(camera.id) { mutableStateOf(StreamingState.Connecting) }

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

    DisposableEffect(
        camera.id,
        sessionToken,
        viewerGeneration,
        lifecycleStarted,
    ) {
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
                    onAuthorizationLost = onAuthorizationLost,
                ).also {
                    it.setListening(listening)
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

    BackHandler(enabled = fullscreen) { fullscreen = false }

    if (fullscreen) {
        Box(
            modifier =
                Modifier.fillMaxSize()
                    .background(Color.Black)
                    .semantics { contentDescription = "Fullscreen live video from ${camera.name}" },
        ) {
            key(camera.id, viewerGeneration) {
                AndroidView(
                    factory = {
                        (renderer.parent as? ViewGroup)?.removeView(renderer)
                        renderer
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Column(
                modifier =
                    Modifier.align(Alignment.TopStart)
                        .padding(16.dp)
                        .background(Color.Black.copy(alpha = 0.62f), RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(camera.name, color = Color.White, style = MaterialTheme.typography.titleMedium)
                Text(
                    "${camera.viewerCount} ${if (camera.viewerCount == 1) "viewer" else "viewers"}",
                    color = Color.White,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Row(
                modifier =
                    Modifier.align(Alignment.BottomCenter)
                        .padding(16.dp)
                        .background(Color.Black.copy(alpha = 0.62f), RoundedCornerShape(16.dp))
                        .padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    enabled = state == StreamingState.Connected,
                    onClick = {
                        listening = !listening
                        viewerSession?.setListening(listening)
                    },
                ) {
                    Icon(if (listening) Icons.Outlined.MicOff else Icons.Outlined.Mic, null, modifier = Modifier.size(19.dp))
                    Text(if (listening) "Mute" else "Listen")
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
        key(camera.id, viewerGeneration) {
            AndroidView(
                factory = {
                    (renderer.parent as? ViewGroup)?.removeView(renderer)
                    renderer
                },
                modifier =
                    Modifier.fillMaxSize()
                        .semantics { contentDescription = "Live video from ${camera.name}" },
            )
        }
        Row(
            modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(shape = RoundedCornerShape(999.dp), color = Color(0xAA09111F)) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to cameras", tint = Color.White)
                }
            }
            BeaconStatusPill(
                if (state == StreamingState.Connected) "LIVE" else "CONNECTING",
                if (state == StreamingState.Connected) Color(0xFFF87171) else Color(0xFFB7C6DE),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(camera.deviceName, color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(camera.name, color = Color(0xFFB7C6DE), style = MaterialTheme.typography.bodySmall)
            }
            IconButton(onClick = onFavorite) {
                Icon(
                    if (favorite) Icons.Outlined.Star else Icons.Outlined.StarBorder,
                    if (favorite) "Remove from favorites" else "Add to favorites",
                    tint = if (favorite) BeaconActionBright else Color.White,
                )
            }
        }
        if (state != StreamingState.Connected) {
            Column(
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    if (state == StreamingState.Connecting) "Connecting to camera" else "Reconnecting to camera",
                    color = Color.White,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(viewerStatusText(state, reconnectAttempt), color = Color(0xFFB7C6DE))
            }
        }
        Column(
            modifier =
                Modifier.align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(Color(0xD909111F))
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = RoundedCornerShape(999.dp), color = Color(0xFF111A2C)) {
                    IconButton(
                        enabled = state == StreamingState.Connected,
                        onClick = {
                            listening = !listening
                            viewerSession?.setListening(listening)
                        },
                    ) {
                        Icon(if (listening) Icons.Outlined.MicOff else Icons.Outlined.Mic, if (listening) "Mute" else "Listen", tint = Color.White)
                    }
                }
                if (onFlip != null) {
                    Surface(shape = RoundedCornerShape(999.dp), color = Color(0xFF111A2C)) {
                        IconButton(
                            onClick = onFlip,
                            modifier = Modifier.semantics { contentDescription = "Switch to ${flipLabel ?: "other camera"}" },
                        ) { Icon(Icons.Outlined.Cameraswitch, null, tint = Color.White) }
                    }
                }
                Surface(shape = RoundedCornerShape(999.dp), color = Color(0xFF111A2C)) {
                    IconButton(enabled = state == StreamingState.Connected, onClick = { fullscreen = true }) {
                        Icon(Icons.Outlined.Fullscreen, "Full screen", tint = Color.White)
                    }
                }
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                IconButton(enabled = onPrevious != null, onClick = { onPrevious?.invoke() }) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Previous camera", tint = Color.White)
                }
                Text(
                    "${camera.viewerCount} ${if (camera.viewerCount == 1) "viewer" else "viewers"} · ${if (listening) "Listening" else "Audio off"}",
                    color = Color(0xFFB7C6DE),
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.align(Alignment.CenterVertically),
                )
                IconButton(enabled = onNext != null, onClick = { onNext?.invoke() }) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowForward, "Next camera", tint = Color.White)
                }
            }
            if (reconnectAttempt > 0 && state != StreamingState.Connected) {
                Text("Reconnect attempt $reconnectAttempt", style = MaterialTheme.typography.bodySmall, color = Color(0xFFB7C6DE))
            }
        }
    }
}


