package com.beaconsecureview.camera

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The camera side of the app (ADR 0121): pairing this phone as a camera and the camera screen. Everything else the
 * person sees is the web app in [WebShellActivity]. A phone that is not a camera never stays here: it opens the web app.
 */
class MainActivity : ComponentActivity() {
    private var autoPairCode by mutableStateOf<String?>(null)
    private var inboundPairingCode by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A phone that is not a camera opens straight into the web app. Only a paired camera, or the web app asking for
        // the camera screen, lands here.
        if (savedInstanceState == null && !wantsCameraScreen(intent)) {
            startActivity(Intent(this, WebShellActivity::class.java).setData(intent?.data))
            finish()
            return
        }
        autoPairCode = pairingCodeFromIntent(intent)
        inboundPairingCode = parsePairingQr(intent?.dataString, BuildConfig.BEACON_API_URL, BuildConfig.BEACON_WEB_URL)
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
                autoPairCode = autoPairCode,
                onAutoPairCodeHandled = { autoPairCode = null },
                inboundPairingCode = inboundPairingCode,
                onInboundPairingCodeHandled = { inboundPairingCode = null },
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pairingCodeFromIntent(intent)?.let { autoPairCode = it }
        inboundPairingCode = parsePairingQr(intent.dataString, BuildConfig.BEACON_API_URL, BuildConfig.BEACON_WEB_URL)
    }

    private fun wantsCameraScreen(intent: Intent?): Boolean =
        intent?.action == ACTION_START_CAMERA ||
            intent?.action == ACTION_OPEN_CAMERA ||
            CredentialStore(this).read() != null

    private fun pairingCodeFromIntent(intent: Intent?): String? =
        if (intent?.action == ACTION_START_CAMERA) {
            normalizePairingCodeInput(intent.getStringExtra(EXTRA_PAIRING_CODE).orEmpty()).takeIf(::isValidPairingCode)
        } else {
            null
        }

    override fun onStart() {
        super.onStart()
        refreshBatteryOptimizationState()
        val cameraAllowed =
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val notificationsAllowed =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        if (
            shouldRunCameraCapture(
                paired = CredentialStore(this).read() != null,
                cameraAllowed = cameraAllowed,
                notificationsAllowed = notificationsAllowed,
            )
        ) {
            CameraForegroundService.start(this)
        }
    }

    override fun onResume() {
        super.onResume()
        // The battery exemption sheet can return without restarting this Activity.
        // Refresh here so the setup card disappears immediately after approval.
        refreshBatteryOptimizationState()
    }

    private fun refreshBatteryOptimizationState() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        CameraRuntime.update {
            it.copy(batteryOptimizationRestricted = !powerManager.isIgnoringBatteryOptimizations(packageName))
        }
    }

    companion object {
        const val ACTION_START_CAMERA = "com.beaconsecureview.camera.START_CAMERA"
        const val ACTION_OPEN_CAMERA = "com.beaconsecureview.camera.OPEN_CAMERA"
        const val EXTRA_PAIRING_CODE = "pairing_code"
    }
}

@Composable
private fun BeaconCameraApp(
    api: BeaconApi,
    credentialStore: CredentialStore,
    installationId: String,
    autoPairCode: String?,
    onAutoPairCodeHandled: () -> Unit,
    inboundPairingCode: String?,
    onInboundPairingCodeHandled: () -> Unit,
) {
    val context = LocalContext.current
    val navigationPreferences = remember { context.getSharedPreferences("beacon_navigation", Context.MODE_PRIVATE) }
    var credential by remember { mutableStateOf(credentialStore.read()) }
    var pairingCode by remember { mutableStateOf("") }
    var pairingState by remember {
        mutableStateOf(if (credential == null) PairingLifecycle.Pending else PairingLifecycle.Completed)
    }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var disconnecting by remember { mutableStateOf(false) }
    var cameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED,
        )
    }
    var notificationPermission by remember {
        mutableStateOf(
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var microphonePermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
        )
    }
    var microphonePermissionResolved by remember {
        mutableStateOf(microphonePermission || navigationPreferences.getBoolean("microphone_permission_asked", false))
    }
    val runtime by CameraRuntime.state.collectAsState()
    val scope = rememberCoroutineScope()

    fun openWebApp() {
        context.startActivity(Intent(context, WebShellActivity::class.java))
    }

    fun pairCamera(code: String) {
        if (busy) return
        val normalized = normalizePairingCodeInput(code)
        pairingCode = normalized
        if (!isValidPairingCode(normalized)) {
            message = "Enter the 10-character pairing code shown in Beacon."
            return
        }
        busy = true
        pairingState = PairingLifecycle.Waiting
        message = "Securely pairing…"
        scope.launch {
            val result =
                withContext(Dispatchers.IO) {
                    runCatching { api.register(installationId, defaultDeviceName(), normalized) }
                }
            result.onSuccess {
                credentialStore.save(it)
                pairingState = PairingLifecycle.Accepted
                pairingCode = ""
                message = ""
                busy = false
            }.onFailure {
                pairingState = PairingLifecycle.Pending
                message =
                    if (it is PairingException) {
                        it.message ?: "Pairing failed. Create a new code and try again."
                    } else {
                        "Beacon cannot reach your account. Check the connection and try again."
                    }
                busy = false
            }
            result.getOrNull()?.let {
                delay(900)
                credential = it
                pairingState = PairingLifecycle.Completed
            }
        }
    }

    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { cameraPermission = it }
    val notificationPermissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { notificationPermission = it }
    val microphonePermissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            microphonePermission = it
            microphonePermissionResolved = true
            navigationPreferences.edit().putBoolean("microphone_permission_asked", true).apply()
            if (it && CameraRuntime.state.value.cameraEnabled) CameraForegroundService.restart(context)
        }

    LaunchedEffect(autoPairCode, credential) {
        // The web app asked this phone to become a camera with a code the signed-in person just created there.
        if (credential == null && autoPairCode != null) {
            onAutoPairCodeHandled()
            pairCamera(autoPairCode)
        }
    }

    LaunchedEffect(inboundPairingCode, credential) {
        if (credential == null && inboundPairingCode != null) {
            onInboundPairingCodeHandled()
            // A link, QR code or another app can send a code here, so it only fills in the field. Joining a household
            // is a tap on Pair (V19b).
            pairingCode = normalizePairingCodeInput(inboundPairingCode)
            message = "A setup link filled in this code. Tap Pair only if you made it yourself from your own Beacon account."
        }
    }

    LaunchedEffect(credential, cameraPermission, notificationPermission, microphonePermissionResolved) {
        if (credential != null && cameraPermission && notificationPermission && microphonePermissionResolved) {
            CameraForegroundService.start(context)
        } else if (credential != null && !cameraPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        } else if (credential != null && !notificationPermission) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else if (credential != null && !microphonePermissionResolved) {
            microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    LaunchedEffect(runtime.pairingRequired) {
        if (runtime.pairingRequired) {
            credentialStore.clear()
            credential = null
            pairingState = PairingLifecycle.Pending
            message = "This device was removed. Scan a new code to reconnect it."
        }
    }

    BeaconTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            when {
                pairingState == PairingLifecycle.Accepted -> PairingSuccess()
                credential == null ->
                    PairingScreen(
                        pairingCode = pairingCode,
                        message = message,
                        busy = busy,
                        onCodeChange = {
                            pairingCode = normalizePairingCodeInput(it)
                            message = ""
                        },
                        onScan = {
                            val options =
                                GmsBarcodeScannerOptions.Builder()
                                    .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                                    .enableAutoZoom()
                                    .build()
                            GmsBarcodeScanning.getClient(context, options)
                                .startScan()
                                .addOnSuccessListener { barcode ->
                                    val scanned = parsePairingQr(barcode.rawValue, BuildConfig.BEACON_API_URL, BuildConfig.BEACON_WEB_URL)
                                    if (scanned == null) {
                                        message = "That is not a Beacon setup link. In Beacon, choose Add a device and scan its QR code."
                                    } else {
                                        pairCamera(scanned)
                                    }
                                }
                                .addOnFailureListener { message = "Unable to scan. Enter the pairing code manually." }
                        },
                        onPair = { pairCamera(pairingCode) },
                        onBack = {
                            pairingCode = ""
                            message = ""
                            openWebApp()
                        },
                    )
                else ->
                    CameraHome(
                        runtime = runtime,
                        cameraPermission = cameraPermission,
                        notificationPermission = notificationPermission,
                        microphonePermission = microphonePermission,
                        onAllowCamera = { permissionLauncher.launch(Manifest.permission.CAMERA) },
                        onAllowNotifications = {
                            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        },
                        onAllowMicrophone = { microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO) },
                        onPrivacy = { CameraForegroundService.setPrivacyMode(context, !runtime.privacyMode) },
                        onSelectCamera = { CameraForegroundService.selectCamera(context, it) },
                        onDisconnect = {
                            val currentCredential = credential
                            if (currentCredential != null && !disconnecting) {
                                disconnecting = true
                                beginLocalDisconnect(credentialStore) { CameraForegroundService.stop(context) }
                                credential = null
                                pairingState = PairingLifecycle.Pending
                                message = "Disconnecting this camera from your account…"
                                CameraRuntime.update { it.copy(diagnostic = "Removing this device securely…") }
                                scope.launch {
                                    val removed =
                                        withContext(Dispatchers.IO) {
                                            runCatching { api.removeRegistration(currentCredential) }
                                        }
                                    removed.onSuccess {
                                        message = "Device removed. Set it up again from Add a device in Beacon."
                                    }.onFailure {
                                        message =
                                            "Disconnected on this phone. Beacon could not remove the offline entry from your account; remove it from Cameras in Beacon."
                                    }
                                    disconnecting = false
                                }
                            }
                        },
                        disconnecting = disconnecting,
                        onOpenBackgroundSettings = {
                            val request =
                                Intent(
                                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                    Uri.parse("package:${context.packageName}"),
                                )
                            runCatching { context.startActivity(request) }
                                .onFailure {
                                    context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                                }
                        },
                        onOpenBeacon = { openWebApp() },
                    )
            }
        }
    }
}

internal fun shouldRunCameraCapture(
    paired: Boolean,
    cameraAllowed: Boolean,
    notificationsAllowed: Boolean,
): Boolean = paired && cameraAllowed && notificationsAllowed

/** The camera screens are dark whatever the phone's theme: a bright screen would light up the room it watches. */
@Composable
@Suppress("DEPRECATION")
private fun BeaconTheme(content: @Composable () -> Unit) {
    val colors = BeaconDarkColorScheme
    val view = LocalView.current
    SideEffect {
        val window = (view.context as? Activity)?.window ?: return@SideEffect
        window.statusBarColor = colors.background.toArgb()
        window.navigationBarColor = colors.background.toArgb()
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
    }
    MaterialTheme(colorScheme = colors, typography = BeaconTypography, shapes = BeaconShapes, content = content)
}

/** The phone's own model makes several paired devices tell apart in the viewer; the owner can rename it. */
internal fun defaultDeviceName(): String =
    listOf(Build.MANUFACTURER, Build.MODEL)
        .filter { it.isNotBlank() }
        .joinToString(" ")
        .replaceFirstChar { it.uppercase() }
        .take(100)
        .ifBlank { "Android Camera" }
