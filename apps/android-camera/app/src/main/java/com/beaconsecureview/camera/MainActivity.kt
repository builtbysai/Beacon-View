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
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
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
    private var inboundGoogleAuthCode by mutableStateOf<MobileGoogleAuthResult?>(null)
    private var launchTarget by mutableStateOf<LaunchTarget?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        inboundPairingCode = parsePairingQr(intent?.dataString, BuildConfig.BEACON_API_URL, BuildConfig.BEACON_WEB_URL)
        inboundGoogleAuthCode = parseMobileGoogleAuthLink(intent?.dataString, BuildConfig.BEACON_API_URL)
        // A relaunch from the recents list repeats the old intent; only a fresh start counts.
        if (savedInstanceState == null) launchTarget = LaunchIntents.parse(intent)
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
                launchTarget = launchTarget,
                onLaunchTargetHandled = { launchTarget = null },
            )
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        inboundPairingCode = parsePairingQr(intent.dataString, BuildConfig.BEACON_API_URL, BuildConfig.BEACON_WEB_URL)
        inboundGoogleAuthCode = parseMobileGoogleAuthLink(intent.dataString, BuildConfig.BEACON_API_URL)
        LaunchIntents.parse(intent)?.let { launchTarget = it }
    }

    override fun onStart() {
        super.onStart()
        refreshBatteryOptimizationState()
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

    override fun onResume() {
        super.onResume()
        // The battery exemption sheet can return without restarting this Activity.
        // Refresh here so the setup card disappears immediately after approval.
        refreshBatteryOptimizationState()
    }

    private fun refreshBatteryOptimizationState() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        CameraRuntime.update {
            it.copy(
                batteryOptimizationRestricted =
                    !powerManager.isIgnoringBatteryOptimizations(packageName),
            )
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
    inboundGoogleAuthCode: MobileGoogleAuthResult?,
    onInboundGoogleAuthCodeHandled: () -> Unit,
    launchTarget: LaunchTarget?,
    onLaunchTargetHandled: () -> Unit,
) {
    val context = LocalContext.current
    val navigationPreferences =
        remember { context.getSharedPreferences("beacon_navigation", Context.MODE_PRIVATE) }
    val appearancePreferences =
        remember { context.getSharedPreferences("beacon_appearance", Context.MODE_PRIVATE) }
    var themePreference by remember {
        mutableStateOf(
            runCatching {
                BeaconThemePreference.valueOf(
                    appearancePreferences.getString("theme", BeaconThemePreference.System.name)!!,
                )
            }.getOrDefault(BeaconThemePreference.System),
        )
    }
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
    var disconnecting by remember { mutableStateOf(false) }
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
    fun pairSignedInCamera(sessionToken: String) {
        if (busy) return
        busy = true
        pairingState = PairingLifecycle.Waiting
        cameraSetupStarted = true
        navigationPreferences.edit().putBoolean("camera_setup_started", true).apply()
        message = "Preparing secure camera setup…"
        selectMonitor(false)
        scope.launch {
            val result =
                withContext(Dispatchers.IO) {
                    runCatching {
                        val code = api.createPairingCode(sessionToken)
                        api.register(installationId, "Android Camera", code)
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
                message = it.userFacingMessage("Beacon could not set up this camera. Try again.")
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
            // A link, QR code or another app can send a code here, so it only
            // fills in the field. Joining a household is a tap on Pair (V19b).
            pairingCode = normalizePairingCodeInput(inboundPairingCode)
            message =
                "A setup link filled in this code. Tap Pair only if you made it yourself from your own Beacon account."
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

    BeaconTheme(
        darkCameraSurface = !monitorMode && credential != null,
        preference = themePreference,
    ) {
        Surface(modifier = Modifier.fillMaxSize()) {
            if (monitorMode) {
                MonitorHome(
                    api = api,
                    sessionStore = accountSessionStore,
                    onCameraMode = { selectMonitor(false) },
                    onSetUpThisDevice = {
                        if (credential == null) pairSignedInCamera(it) else selectMonitor(false)
                    },
                    onAccountDeleted = {
                        CameraForegroundService.stop(context)
                        credentialStore.clear()
                        credential = null
                    },
                    inboundGoogleAuthCode = inboundGoogleAuthCode,
                    onInboundGoogleAuthCodeHandled = onInboundGoogleAuthCodeHandled,
                    launchTarget = launchTarget,
                    onLaunchTargetHandled = onLaunchTargetHandled,
                    onGoogleSignIn = {
                        context.startActivity(
                            Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse(
                                    "${BuildConfig.BEACON_API_URL.trimEnd('/')}/api/auth/google?platform=android" +
                                        "&challenge=${GoogleSignInPkce(context).begin()}",
                                ),
                            ).addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY),
                        )
                    },
                    themePreference = themePreference,
                    onThemePreferenceChange = {
                        themePreference = it
                        appearancePreferences.edit().putString("theme", it.name).apply()
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
                                    val scanned = parsePairingQr(barcode.rawValue, BuildConfig.BEACON_API_URL, BuildConfig.BEACON_WEB_URL)
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
                            if (currentCredential != null && !disconnecting) {
                                disconnecting = true
                                beginLocalDisconnect(credentialStore) {
                                    CameraForegroundService.stop(context)
                                }
                                credential = null
                                pairingState = PairingLifecycle.Pending
                                message = "Disconnecting this camera from your account…"
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
                                        message = "Device removed. Scan a new code to connect it again."
                                    }.onFailure {
                                        message =
                                            "Disconnected on this phone. Beacon could not remove the offline entry from your account; remove it from Cameras in the web app."
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
                                    context.startActivity(
                                        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
                                    )
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
@Suppress("DEPRECATION")
private fun BeaconTheme(
    darkCameraSurface: Boolean,
    preference: BeaconThemePreference,
    content: @Composable () -> Unit,
) {
    val useDarkColors =
        darkCameraSurface ||
            when (preference) {
                BeaconThemePreference.Light -> false
                BeaconThemePreference.System -> isSystemInDarkTheme()
                BeaconThemePreference.Dark -> true
            }
    val colors = if (useDarkColors) BeaconDarkColorScheme else BeaconLightColorScheme
    val view = LocalView.current
    SideEffect {
        val window = (view.context as? Activity)?.window ?: return@SideEffect
        window.statusBarColor = colors.background.toArgb()
        window.navigationBarColor = colors.background.toArgb()
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !useDarkColors
            isAppearanceLightNavigationBars = !useDarkColors
        }
    }
    MaterialTheme(
        colorScheme = colors,
        typography = BeaconTypography,
        shapes = BeaconShapes,
        content = content,
    )
}
