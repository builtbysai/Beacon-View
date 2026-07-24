package com.beaconsecureview.camera

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val credentialStore = CredentialStore(this)
        val preferences = getSharedPreferences("beacon_installation", MODE_PRIVATE)
        val installationId =
            preferences.getString("installation_id", null)
                ?: UUID.randomUUID().toString().also {
                    preferences.edit().putString("installation_id", it).apply()
                }
        setContent {
            BeaconRegistration(
                api = BeaconApi(BuildConfig.BEACON_API_URL),
                credentialStore = credentialStore,
                installationId = installationId,
                lifecycleOwner = this,
            )
        }
    }
}

@Composable
private fun BeaconRegistration(
    api: BeaconApi,
    credentialStore: CredentialStore,
    installationId: String,
    lifecycleOwner: ComponentActivity,
) {
    val context = LocalContext.current
    var credential by remember { mutableStateOf(credentialStore.read()) }
    var pairingCode by remember { mutableStateOf("") }
    var message by remember {
        mutableStateOf(if (credential == null) "This device is not registered." else "Registered")
    }
    var busy by remember { mutableStateOf(false) }
    var streamingState by remember { mutableStateOf(StreamingState.Waiting) }
    var cameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            cameraPermission = it
            if (!it) streamingState = StreamingState.PermissionRequired
        }
    val previewView = remember { PreviewView(context) }
    var webRtcSession by remember { mutableStateOf<WebRtcCameraSession?>(null) }
    var signalingClient by remember { mutableStateOf<CameraSignalingClient?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(credential) {
        while (credential != null) {
            delay(30_000)
            val current = credential ?: break
            val accepted =
                withContext(Dispatchers.IO) {
                    runCatching { api.heartbeat(current) }.getOrNull()
                }
            when (accepted) {
                true -> message = "Heartbeat sent"
                false -> {
                    message = "Credential revoked or unavailable"
                    retainCredentialAfterHeartbeat(credentialStore, accepted = false)
                    credential = null
                }
                null -> message = "Heartbeat temporarily unavailable; retrying"
            }
        }
    }

    DisposableEffect(credential, cameraPermission) {
        val currentCredential = credential
        if (currentCredential != null && cameraPermission) {
            lateinit var client: CameraSignalingClient
            val listener =
                object : CameraSignalingListener {
                    override fun onViewerReady(
                        connectionId: String,
                        iceServers: List<SignalingIceServer>,
                    ) {
                        webRtcSession?.close()
                        webRtcSession =
                            WebRtcCameraSession(
                                context,
                                lifecycleOwner,
                                previewView,
                                iceServers,
                                connectionId,
                                client,
                            ) { state ->
                                lifecycleOwner.runOnUiThread {
                                    streamingState = state
                                    if (
                                        state == StreamingState.Disconnected ||
                                            state == StreamingState.Failed
                                    ) {
                                        val existing = webRtcSession
                                        webRtcSession = null
                                        existing?.close()
                                    }
                                }
                            }
                        webRtcSession?.start()
                    }

                    override fun onAnswer(connectionId: String, sdp: String) {
                        webRtcSession?.setAnswer(sdp)
                    }

                    override fun onIce(connectionId: String, candidate: org.webrtc.IceCandidate) {
                        webRtcSession?.addIce(candidate)
                    }

                    override fun onPeerLeft() {
                        val existing = webRtcSession
                        webRtcSession = null
                        existing?.close()
                        streamingState = StreamingState.Waiting
                    }

                    override fun onSignalingState(state: StreamingState) {
                        streamingState = state
                        if (
                            state == StreamingState.Disconnected ||
                                state == StreamingState.Failed
                        ) {
                            val existing = webRtcSession
                            webRtcSession = null
                            existing?.close()
                        }
                    }
                }
            client = CameraSignalingClient(BuildConfig.BEACON_API_URL, currentCredential, listener)
            signalingClient = client
            client.connect()
        }
        onDispose {
            val existing = webRtcSession
            webRtcSession = null
            existing?.close()
            signalingClient?.disconnect(null)
            signalingClient = null
        }
    }

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Beacon SecureView", style = MaterialTheme.typography.headlineMedium)
                Text(message, modifier = Modifier.padding(vertical = 16.dp))
                if (credential == null) {
                    OutlinedTextField(
                        value = pairingCode,
                        onValueChange = { pairingCode = it.uppercase() },
                        label = { Text("Pairing code") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    Button(
                        enabled = pairingCode.isNotBlank() && !busy,
                        onClick = {
                            busy = true
                            message = "Pairing…"
                            scope.launch {
                                runCatching {
                                    withContext(Dispatchers.IO) {
                                        api.register(installationId, "Android Camera", pairingCode)
                                    }
                                }.onSuccess {
                                    credentialStore.save(it)
                                    credential = it
                                    pairingCode = ""
                                    message = "Pairing succeeded"
                                    busy = false
                                }.onFailure {
                                    message = "Pairing failed"
                                    busy = false
                                }
                            }
                        },
                    ) {
                        Text("Pair device")
                    }
                } else {
                    if (!cameraPermission) {
                        Text("Camera permission is required only for visible live streaming.")
                        Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                            Text("Allow camera")
                        }
                    } else {
                        Text("Streaming status: ${streamingState.name}")
                    }
                    if (
                        streamingState == StreamingState.Connecting ||
                            streamingState == StreamingState.Streaming
                    ) {
                        Text(
                            "Camera active — live video capture is visible",
                            color = Color.Red,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                        AndroidView(
                            factory = { previewView },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    Button(
                        onClick = {
                            webRtcSession?.close()
                            signalingClient?.disconnect(null)
                            credentialStore.clear()
                            credential = null
                            message = "Local credential cleared"
                        },
                    ) {
                        Text("Clear local credential")
                    }
                }
            }
        }
    }
}
