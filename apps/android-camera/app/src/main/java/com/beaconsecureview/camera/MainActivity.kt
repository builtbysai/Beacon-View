package com.beaconsecureview.camera

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

class MainActivity : ComponentActivity() {
    private var inboundPairingCode by mutableStateOf<String?>(null)
    private var inboundGoogleAuthCode by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        inboundPairingCode = parsePairingQr(intent?.dataString, BuildConfig.BEACON_API_URL)
        inboundGoogleAuthCode = parseMobileGoogleAuthLink(intent?.dataString, BuildConfig.BEACON_API_URL)
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
                accountSessionStore = AccountSessionStore(this),
                installationId = installationId,
                inboundPairingCode = inboundPairingCode,
                onInboundPairingCodeHandled = { inboundPairingCode = null },
                inboundGoogleAuthCode = inboundGoogleAuthCode,
                onInboundGoogleAuthCodeHandled = { inboundGoogleAuthCode = null },
            )
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        inboundPairingCode = parsePairingQr(intent.dataString, BuildConfig.BEACON_API_URL)
        inboundGoogleAuthCode = parseMobileGoogleAuthLink(intent.dataString, BuildConfig.BEACON_API_URL)
    }

    override fun onStart() {
        super.onStart()
        val monitorMode =
            getSharedPreferences("beacon_navigation", MODE_PRIVATE)
                .getBoolean("monitor_destination", false)
        val cameraAllowed =
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        val notificationsAllowed =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED
        if (
            shouldRunCameraCapture(
                monitorMode = monitorMode,
                paired = CredentialStore(this).read() != null,
                cameraAllowed = cameraAllowed,
                notificationsAllowed = notificationsAllowed,
            )
        ) {
            CameraForegroundService.start(this)
        } else if (monitorMode) {
            CameraForegroundService.stop(this)
        }
    }
}

@Composable
private fun BeaconCameraApp(
    api: BeaconApi,
    credentialStore: CredentialStore,
    accountSessionStore: AccountSessionStore,
    installationId: String,
    inboundPairingCode: String?,
    onInboundPairingCodeHandled: () -> Unit,
    inboundGoogleAuthCode: String?,
    onInboundGoogleAuthCodeHandled: () -> Unit,
) {
    val context = LocalContext.current
    val navigationPreferences =
        remember { context.getSharedPreferences("beacon_navigation", Context.MODE_PRIVATE) }
    var credential by remember { mutableStateOf(credentialStore.read()) }
    var cameraSetupStarted by rememberSaveable {
        mutableStateOf(
            credential != null ||
                inboundPairingCode != null ||
                navigationPreferences.getBoolean("camera_setup_started", false),
        )
    }
    var pairingCode by remember { mutableStateOf("") }
    var pairingState by remember {
        mutableStateOf(
            if (credential == null) PairingLifecycle.Pending else PairingLifecycle.Completed,
        )
    }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var monitorMode by remember {
        mutableStateOf(navigationPreferences.getBoolean("monitor_destination", false))
    }
    fun selectMonitor(enabled: Boolean) {
        navigationPreferences.edit().putBoolean("monitor_destination", enabled).apply()
        monitorMode = enabled
    }
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
    var microphonePermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var microphonePermissionResolved by remember {
        mutableStateOf(
            microphonePermission || navigationPreferences.getBoolean("microphone_permission_asked", false),
        )
    }
    val runtime by CameraRuntime.state.collectAsState()
    val scope = rememberCoroutineScope()
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
                    runCatching {
                        api.register(installationId, "Android Camera", normalized)
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
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            cameraPermission = it
        }
    val notificationPermissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            notificationPermission = it
        }
    val microphonePermissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            microphonePermission = it
            microphonePermissionResolved = true
            navigationPreferences.edit().putBoolean("microphone_permission_asked", true).apply()
            if (it && CameraRuntime.state.value.cameraEnabled) {
                CameraForegroundService.restart(context)
            }
        }

    LaunchedEffect(inboundPairingCode, credential) {
        if (credential == null && inboundPairingCode != null) {
            cameraSetupStarted = true
            navigationPreferences.edit().putBoolean("camera_setup_started", true).apply()
            onInboundPairingCodeHandled()
            pairCamera(inboundPairingCode)
        }
    }

    LaunchedEffect(
        credential,
        cameraPermission,
        notificationPermission,
        microphonePermissionResolved,
        monitorMode,
    ) {
        if (monitorMode) {
            CameraForegroundService.stop(context)
        } else if (
            credential != null &&
                cameraPermission &&
                notificationPermission &&
                microphonePermissionResolved
        ) {
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

    BeaconTheme(darkCameraSurface = !monitorMode && credential != null) {
        Surface(modifier = Modifier.fillMaxSize()) {
            if (monitorMode) {
                MonitorHome(
                    api = api,
                    sessionStore = accountSessionStore,
                    onCameraMode = { selectMonitor(false) },
                    onAccountDeleted = {
                        CameraForegroundService.stop(context)
                        credentialStore.clear()
                        credential = null
                    },
                    inboundGoogleAuthCode = inboundGoogleAuthCode,
                    onInboundGoogleAuthCodeHandled = onInboundGoogleAuthCodeHandled,
                    onGoogleSignIn = {
                        context.startActivity(
                            Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse("${BuildConfig.BEACON_API_URL.trimEnd('/')}/api/auth/google?platform=android"),
                            ).addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY),
                        )
                    },
                )
            } else when {
                pairingState == PairingLifecycle.Accepted -> PairingSuccess()
                shouldShowWelcome(
                    paired = credential != null,
                    monitorMode = monitorMode,
                    cameraSetupStarted = cameraSetupStarted,
                ) ->
                    WelcomeScreen(
                        onCameraSetup = {
                            cameraSetupStarted = true
                            navigationPreferences.edit()
                                .putBoolean("camera_setup_started", true)
                                .apply()
                        },
                        onMonitor = { selectMonitor(true) },
                    )
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
                                    val scanned = parsePairingQr(barcode.rawValue, BuildConfig.BEACON_API_URL)
                                    if (scanned == null) {
                                        message =
                                            "That is not a Beacon setup link. In Beacon web, choose Add camera and scan its QR code."
                                    } else {
                                        pairCamera(scanned)
                                    }
                                }
                                .addOnFailureListener {
                                    message = "Unable to scan. Enter the pairing code manually."
                                }
                        },
                        onPair = { pairCamera(pairingCode) },
                        onBack = {
                            pairingCode = ""
                            message = ""
                            cameraSetupStarted = false
                            navigationPreferences.edit()
                                .putBoolean("camera_setup_started", false)
                                .apply()
                        },
                    )
                else ->
                    CameraHome(
                        runtime = runtime,
                        cameraPermission = cameraPermission,
                        notificationPermission = notificationPermission,
                        microphonePermission = microphonePermission,
                        onAllowCamera = {
                            permissionLauncher.launch(Manifest.permission.CAMERA)
                        },
                        onAllowNotifications = {
                            notificationPermissionLauncher.launch(
                                Manifest.permission.POST_NOTIFICATIONS,
                            )
                        },
                        onAllowMicrophone = {
                            microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        },
                        onPrivacy = {
                            CameraForegroundService.setPrivacyMode(context, !runtime.privacyMode)
                        },
                        onSelectCamera = {
                            CameraForegroundService.selectCamera(context, it)
                        },
                        onDisconnect = {
                            val currentCredential = credential
                            if (currentCredential != null) {
                                CameraRuntime.update {
                                    it.copy(diagnostic = "Removing this device securely…")
                                }
                                scope.launch {
                                    val removed =
                                        withContext(Dispatchers.IO) {
                                            runCatching {
                                                api.removeRegistration(currentCredential)
                                            }
                                        }
                                    removed.onSuccess {
                                        CameraForegroundService.stop(context)
                                        credentialStore.clear()
                                        credential = null
                                        pairingState = PairingLifecycle.Pending
                                        message = "Device removed. Scan a new code to connect it again."
                                    }.onFailure {
                                        // The DELETE closes the device signaling socket. That callback can clear
                                        // the credential before the HTTP response reaches this coroutine; in that
                                        // case the requested removal already succeeded.
                                        if (credentialStore.read() == null) {
                                            credential = null
                                            pairingState = PairingLifecycle.Pending
                                            message =
                                                "Device removed. Scan a new code to connect it again."
                                        } else {
                                            CameraRuntime.update {
                                                it.copy(
                                                    diagnostic =
                                                        "Could not remove this device. Check the connection and try again.",
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        onMonitor = { selectMonitor(true) },
                        monitorSignedIn = accountSessionStore.read() != null,
                    )
            }
        }
    }
}

internal fun shouldRunCameraCapture(
    monitorMode: Boolean,
    paired: Boolean,
    cameraAllowed: Boolean,
    notificationsAllowed: Boolean,
): Boolean = !monitorMode && paired && cameraAllowed && notificationsAllowed

internal fun shouldShowWelcome(
    paired: Boolean,
    monitorMode: Boolean,
    cameraSetupStarted: Boolean,
): Boolean = !paired && !monitorMode && !cameraSetupStarted

@Composable
private fun BeaconTheme(
    darkCameraSurface: Boolean,
    content: @Composable () -> Unit,
) {
    val useDarkColors = darkCameraSurface || isSystemInDarkTheme()
    val light =
        lightColorScheme(
            primary = Color(0xFF0369A1),
            onPrimary = Color.White,
            primaryContainer = Color(0xFFE0F2FE),
            onPrimaryContainer = Color(0xFF075985),
            secondary = Color(0xFF475569),
            background = Color(0xFFF5F7FB),
            surface = Color.White,
            surfaceVariant = Color(0xFFF1F5F9),
            onSurface = Color(0xFF0F172A),
            onSurfaceVariant = Color(0xFF48566B),
            outline = Color(0xFFCBD3DD),
            outlineVariant = Color(0xFFE3E8F0),
            error = Color(0xFFB91C1C),
        )
    val dark =
        darkColorScheme(
            primary = Color(0xFF38BDF8),
            onPrimary = Color(0xFF04101C),
            primaryContainer = Color(0xFF0C4A6E),
            onPrimaryContainer = Color(0xFFBAE6FD),
            secondary = Color(0xFFA7B3C8),
            background = Color(0xFF090D16),
            surface = Color(0xFF111A2C),
            surfaceVariant = Color(0xFF152035),
            onSurface = Color(0xFFEEF2F8),
            onSurfaceVariant = Color(0xFFA7B3C8),
            outline = Color(0xFF2C3D5C),
            outlineVariant = Color(0xFF21304A),
            error = Color(0xFFF87171),
        )
    MaterialTheme(
        colorScheme = if (useDarkColors) dark else light,
        typography =
            Typography(
                headlineLarge = MaterialTheme.typography.headlineLarge.copy(lineHeight = 38.sp),
                bodyLarge = MaterialTheme.typography.bodyLarge.copy(lineHeight = 24.sp),
            ),
        content = content,
    )
}
