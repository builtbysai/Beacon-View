package com.beaconsecureview.camera

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val preferences = getSharedPreferences("beacon_installation", MODE_PRIVATE)
        val installationId =
            preferences.getString("installation_id", null)
                ?: UUID.randomUUID().toString().also {
                    preferences.edit().putString("installation_id", it).apply()
                }
        setContent {
            BeaconCameraApp(
                api = BeaconApi(BuildConfig.BEACON_API_URL),
                credentialStore = CredentialStore(this),
                installationId = installationId,
            )
        }
    }
}

@Composable
private fun BeaconCameraApp(
    api: BeaconApi,
    credentialStore: CredentialStore,
    installationId: String,
) {
    val context = LocalContext.current
    var credential by remember { mutableStateOf(credentialStore.read()) }
    var pairingCode by remember { mutableStateOf("") }
    var pairingState by remember {
        mutableStateOf(
            if (credential == null) PairingLifecycle.Pending else PairingLifecycle.Completed,
        )
    }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var cameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var notificationPermission by remember {
        mutableStateOf(
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) == PackageManager.PERMISSION_GRANTED,
        )
    }
    val runtime by CameraRuntime.state.collectAsState()
    val scope = rememberCoroutineScope()
    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            cameraPermission = it
        }
    val notificationPermissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            notificationPermission = it
        }

    LaunchedEffect(credential, cameraPermission, notificationPermission) {
        if (credential != null && cameraPermission && notificationPermission) {
            CameraForegroundService.start(context)
        } else if (credential != null && !cameraPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        } else if (credential != null && !notificationPermission) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            when {
                pairingState == PairingLifecycle.Accepted -> PairingSuccess()
                credential == null ->
                    PairingScreen(
                        pairingCode = pairingCode,
                        message = message,
                        busy = busy,
                        onCodeChange = { pairingCode = it.uppercase() },
                        onPair = {
                            busy = true
                            pairingState = PairingLifecycle.Waiting
                            message = "Securely pairing…"
                            scope.launch {
                                val result =
                                    runCatching {
                                    withContext(Dispatchers.IO) {
                                        api.register(
                                            installationId,
                                            "Android Camera",
                                            pairingCode,
                                        )
                                    }
                                }
                                result.onSuccess {
                                    credentialStore.save(it)
                                    pairingState = PairingLifecycle.Accepted
                                    pairingCode = ""
                                    message = ""
                                    busy = false
                                }.onFailure {
                                    pairingState = PairingLifecycle.Pending
                                    message = "Pairing failed. Check the code and try again."
                                    busy = false
                                }
                                result.getOrNull()?.let {
                                    delay(900)
                                    credential = it
                                    pairingState = PairingLifecycle.Completed
                                }
                            }
                        },
                    )
                else ->
                    CameraHome(
                        runtime = runtime,
                        cameraPermission = cameraPermission,
                        notificationPermission = notificationPermission,
                        onAllowCamera = {
                            permissionLauncher.launch(Manifest.permission.CAMERA)
                        },
                        onAllowNotifications = {
                            notificationPermissionLauncher.launch(
                                Manifest.permission.POST_NOTIFICATIONS,
                            )
                        },
                        onStart = { CameraForegroundService.start(context) },
                        onStop = { CameraForegroundService.stop(context) },
                        onSelectCamera = {
                            CameraForegroundService.selectCamera(context, it)
                        },
                        onPairNewAccount = {
                            CameraForegroundService.stop(context)
                            credentialStore.clear()
                            credential = null
                            pairingState = PairingLifecycle.Pending
                            message = "Ready to pair with another account."
                        },
                    )
            }
        }
    }
}

@Composable
private fun PairingScreen(
    pairingCode: String,
    message: String,
    busy: Boolean,
    onCodeChange: (String) -> Unit,
    onPair: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Beacon SecureView", style = MaterialTheme.typography.headlineLarge)
        Text(
            "Turn this phone into a household camera.",
            modifier = Modifier.padding(vertical = 12.dp),
        )
        OutlinedTextField(
            value = pairingCode,
            onValueChange = onCodeChange,
            label = { Text("Pairing code") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Button(
            enabled = pairingCode.isNotBlank() && !busy,
            onClick = onPair,
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Text(if (busy) "Pairing…" else "Pair device")
        }
        if (message.isNotBlank()) Text(message, modifier = Modifier.padding(top = 12.dp))
    }
}

@Composable
private fun PairingSuccess() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("✓", color = Color(0xFF12805C), style = MaterialTheme.typography.displayLarge)
        Text("Camera connected", style = MaterialTheme.typography.headlineMedium)
        Text("Starting Camera Mode…")
    }
}

@Composable
private fun CameraHome(
    runtime: CameraRuntimeState,
    cameraPermission: Boolean,
    notificationPermission: Boolean,
    onAllowCamera: () -> Unit,
    onAllowNotifications: () -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onSelectCamera: (String) -> Unit,
    onPairNewAccount: () -> Unit,
) {
    val context = LocalContext.current
    val battery =
        remember {
            val manager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        }
    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Camera Home", style = MaterialTheme.typography.headlineLarge)
        Row(
            modifier =
                Modifier.fillMaxWidth()
                    .background(Color(0xFFE6F6EF), RoundedCornerShape(12.dp))
                    .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text("Android Camera", style = MaterialTheme.typography.titleLarge)
                Text(runtime.device.name.uppercase(), color = Color(0xFF12805C))
            }
            Text("$battery% battery")
        }
        if (runtime.activeViewers > 0) {
            Text(
                "● LIVE · ${runtime.activeViewers} viewer${if (runtime.activeViewers == 1) "" else "s"}",
                color = Color.Red,
                style = MaterialTheme.typography.titleMedium,
            )
        } else {
            Text("Ready for an authorized viewer")
        }
        if (runtime.activeViewers > 0 && CameraRuntime.previewView != null) {
            AndroidView(
                factory = { CameraRuntime.previewView ?: PreviewView(it) },
                modifier = Modifier.fillMaxWidth().height(260.dp),
            )
        } else {
            Column(
                modifier =
                    Modifier.fillMaxWidth()
                        .height(180.dp)
                        .background(Color(0xFF101820), RoundedCornerShape(12.dp)),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Preview appears while streaming", color = Color.White)
            }
        }
        Text("Network: ${runtime.diagnostic}")
        Text("Reconnect attempts: ${runtime.retryAttempt}")
        if (runtime.batteryOptimizationRestricted) {
            Text(
                "Battery optimization may stop reliable background camera operation. " +
                    "Allow unrestricted battery use in Android settings for this device.",
            )
        }
        if (runtime.cameras.size > 1) {
            Text("Camera source", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                runtime.cameras.forEach { camera ->
                    if (camera.id == runtime.selectedCameraId) {
                        Button(onClick = { onSelectCamera(camera.id) }) {
                            Text(camera.name)
                        }
                    } else {
                        OutlinedButton(onClick = { onSelectCamera(camera.id) }) {
                            Text(camera.name)
                        }
                    }
                }
            }
            Text("This device can stream one camera source at a time.")
        }
        if (!cameraPermission) {
            Button(onClick = onAllowCamera, modifier = Modifier.fillMaxWidth()) {
                Text("Allow camera")
            }
        } else if (!notificationPermission) {
            Button(onClick = onAllowNotifications, modifier = Modifier.fillMaxWidth()) {
                Text("Allow camera status notification")
            }
        } else if (runtime.cameraEnabled) {
            OutlinedButton(onClick = onStop, modifier = Modifier.fillMaxWidth()) {
                Text("Stop camera")
            }
        } else {
            Button(onClick = onStart, modifier = Modifier.fillMaxWidth()) {
                Text("Start camera")
            }
        }
        OutlinedButton(onClick = onPairNewAccount, modifier = Modifier.fillMaxWidth()) {
            Text("Pair new account")
        }
        Text(
            "Camera operation continues when this screen is closed. A persistent notification " +
                "shows whenever Camera Mode is active.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
