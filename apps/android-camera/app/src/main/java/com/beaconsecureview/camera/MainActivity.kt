package com.beaconsecureview.camera

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.webrtc.SurfaceViewRenderer

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
            pairingCode = inboundPairingCode
            message = "Pairing link opened. Confirm the code to connect this camera."
            onInboundPairingCodeHandled()
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
                    inboundGoogleAuthCode = inboundGoogleAuthCode,
                    onInboundGoogleAuthCodeHandled = onInboundGoogleAuthCodeHandled,
                    onGoogleSignIn = {
                        context.startActivity(
                            Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse("${BuildConfig.BEACON_API_URL.trimEnd('/')}/api/auth/google?platform=android"),
                            ),
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
                                        pairingCode = scanned
                                        message = "Pairing code scanned."
                                    }
                                }
                                .addOnFailureListener {
                                    message = "Unable to scan. Enter the pairing code manually."
                                }
                        },
                        onPair = pair@{
                            if (!isValidPairingCode(pairingCode)) {
                                message = "Enter the 10-character pairing code shown in Beacon."
                                return@pair
                            }
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
                        },
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
                        onPairNewAccount = {
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
private fun MonitorHome(
    api: BeaconApi,
    sessionStore: AccountSessionStore,
    onCameraMode: () -> Unit,
    inboundGoogleAuthCode: String?,
    onInboundGoogleAuthCodeHandled: () -> Unit,
    onGoogleSignIn: () -> Unit,
) {
    val context = LocalContext.current
    var session by remember { mutableStateOf(sessionStore.read()) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var cameras by remember { mutableStateOf<List<BeaconApi.MonitorCamera>>(emptyList()) }
    var selectedCameraId by rememberSaveable { mutableStateOf<String?>(null) }
    val favoritesStore = remember(context) { CameraFavoritesStore(context.applicationContext) }
    val orderStore = remember(context) { CameraOrderStore(context.applicationContext) }
    var favoriteCameraIds by remember(session?.userId) {
        mutableStateOf(session?.let { favoritesStore.read(it.userId) } ?: emptySet())
    }
    var cameraOrderIds by remember(session?.userId) {
        mutableStateOf(session?.let { orderStore.read(it.userId) } ?: emptyList())
    }
    var favoritesOnly by rememberSaveable(session?.userId) { mutableStateOf(false) }
    var reordering by rememberSaveable(session?.userId) { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(inboundGoogleAuthCode) {
        val code = inboundGoogleAuthCode ?: return@LaunchedEffect
        onInboundGoogleAuthCodeHandled()
        if (session != null) return@LaunchedEffect
        busy = true
        val result = withContext(Dispatchers.IO) { runCatching { api.exchangeGoogleSignIn(code) } }
        result.onSuccess {
            sessionStore.save(it)
            session = it
            message = ""
        }.onFailure { message = it.message ?: "Google sign-in could not be completed." }
        busy = false
    }

    fun refresh(token: String, showLoading: Boolean = cameras.isEmpty()) {
        if (showLoading) busy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { api.listMonitorCameras(token) } }
            result.onSuccess {
                cameras = it
                val userId = session?.userId
                if (userId != null) {
                    val normalized =
                        normalizedCameraOrder(cameraOrderIds, it.map { camera -> camera.id })
                    if (normalized != cameraOrderIds) {
                        cameraOrderIds = normalized
                        orderStore.write(userId, normalized)
                    }
                }
                message = ""
            }.onFailure {
                if (it is AuthorizationLostException) {
                    sessionStore.clear()
                    session = null
                    selectedCameraId = null
                    message = "Your session expired. Sign in again."
                } else {
                    message = it.message ?: "Cameras are temporarily unavailable"
                }
            }
            if (showLoading) busy = false
        }
    }

    LaunchedEffect(session) {
        val active = session ?: return@LaunchedEffect
        while (session == active) {
            refresh(active.token)
            delay(15_000)
        }
    }

    val activeSession = session
    val orderByCameraId = cameraOrderIds.withIndex().associate { it.value to it.index }
    val orderedCameras = cameras.sortedBy { orderByCameraId[it.id] ?: Int.MAX_VALUE }
    val activeCamera = orderedCameras.find { it.id == selectedCameraId }
    if (activeSession != null && activeCamera != null) {
        val activeIndex = orderedCameras.indexOfFirst { it.id == activeCamera.id }
        AndroidLiveView(
            camera = activeCamera,
            sessionToken = activeSession.token,
            onBack = { selectedCameraId = null },
            onPrevious =
                orderedCameras.getOrNull(activeIndex - 1)?.let { previous ->
                    { selectedCameraId = previous.id }
                },
            onNext =
                orderedCameras.getOrNull(activeIndex + 1)?.let { next ->
                    { selectedCameraId = next.id }
                },
            onAuthorizationLost = {
                sessionStore.clear()
                session = null
                selectedCameraId = null
                cameras = emptyList()
                message = "Your session expired. Sign in again."
            },
            favorite = activeCamera.id in favoriteCameraIds,
            onFavorite = {
                favoriteCameraIds = favoritesStore.toggle(activeSession.userId, activeCamera.id)
            },
        )
        return
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier.fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
        Text("Monitor", style = MaterialTheme.typography.headlineLarge)
        if (session == null) {
            Text("Sign in to view your cameras.")
            Button(
                enabled = !busy,
                onClick = onGoogleSignIn,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Continue with Google") }
            Text("or", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = email.isNotBlank() && password.isNotBlank() && !busy,
                onClick = {
                    busy = true
                    scope.launch {
                        val result =
                            withContext(Dispatchers.IO) { runCatching { api.login(email, password) } }
                        result.onSuccess {
                            sessionStore.save(it)
                            password = ""
                            session = it
                            message = ""
                        }.onFailure { message = it.message ?: "Sign in failed" }
                        busy = false
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (busy) "Signing in…" else "Sign in")
            }
        } else {
            OutlinedButton(
                onClick = {
                    val token = session!!.token
                    sessionStore.clear()
                    session = null
                    selectedCameraId = null
                    cameras = emptyList()
                    message = "Signed out on this phone."
                    scope.launch(Dispatchers.IO) { runCatching { api.logout(token) } }
                },
            ) { Text("Sign out") }
            if (busy) Text("Loading cameras…")
            if (!busy && cameras.isEmpty()) Text("No cameras are connected to this account yet.")
            if (cameras.isNotEmpty()) {
                val health = monitorHealth(cameras)
                Text(
                    "${health.cameras} cameras · ${health.online} online · " +
                        "${health.offline} offline · ${health.live} live · " +
                        "${health.viewers} viewers",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier =
                        Modifier.fillMaxWidth().semantics {
                            contentDescription =
                                "Camera health: ${health.cameras} total, ${health.online} online, " +
                                    "${health.offline} offline, ${health.live} live, " +
                                    "${health.viewers} viewers"
                        },
                )
            }
            if (favoriteCameraIds.isNotEmpty()) {
                OutlinedButton(
                    onClick = { favoritesOnly = !favoritesOnly },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (favoritesOnly) "Show all cameras" else "Show favorites")
                }
            }
            if (cameras.size > 1 && !favoritesOnly) {
                OutlinedButton(
                    onClick = { reordering = !reordering },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (reordering) "Finish ordering" else "Change camera order")
                }
            }
            val visibleCameras =
                monitorVisibleCameras(orderedCameras, favoriteCameraIds, favoritesOnly)
            if (favoritesOnly && visibleCameras.isEmpty()) {
                Text(
                    "No favorite cameras are available. Show all cameras to choose one.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
                val columns = monitorColumnCount(maxWidth.value)
                val gap = 12.dp
                val tileWidth = (maxWidth - gap * (columns - 1)) / columns
                Column(verticalArrangement = Arrangement.spacedBy(gap)) {
                    visibleCameras
                        .chunked(columns)
                        .forEach { rowCameras ->
                        Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                            rowCameras.forEach { camera ->
                                val orderIndex = orderedCameras.indexOfFirst { it.id == camera.id }
                                MonitorCameraCard(
                                    camera = camera,
                                    onView = { selectedCameraId = camera.id },
                                    reordering = reordering,
                                    canMoveEarlier = orderIndex > 0,
                                    canMoveLater = orderIndex in 0 until orderedCameras.lastIndex,
                                    onMoveEarlier = {
                                        val updated = movedCameraId(cameraOrderIds, camera.id, -1)
                                        cameraOrderIds = updated
                                        orderStore.write(session!!.userId, updated)
                                    },
                                    onMoveLater = {
                                        val updated = movedCameraId(cameraOrderIds, camera.id, 1)
                                        cameraOrderIds = updated
                                        orderStore.write(session!!.userId, updated)
                                    },
                                    modifier = Modifier.width(tileWidth),
                                )
                            }
                        }
                    }
                }
            }
        }
            if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.error)
        }
        BeaconDestinationSwitcher(
            monitorSelected = true,
            onCamera = onCameraMode,
            onMonitor = {},
            modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 16.dp),
        )
    }
}

@Composable
private fun MonitorCameraCard(
    camera: BeaconApi.MonitorCamera,
    onView: () -> Unit,
    reordering: Boolean,
    canMoveEarlier: Boolean,
    canMoveLater: Boolean,
    onMoveEarlier: () -> Unit,
    onMoveLater: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val available = camera.online && !camera.privacyMode
    Column(
        modifier =
            modifier
                .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(16.dp))
                .clickable(
                    enabled = available,
                    onClickLabel = "View ${camera.name} live",
                    role = Role.Button,
                    onClick = onView,
                )
                .padding(16.dp)
                .semantics {
                    contentDescription =
                        "${camera.name}, camera on ${camera.deviceName}, " +
                            when {
                                camera.privacyMode -> "privacy on"
                                camera.online -> "online, open live view"
                                else -> "offline"
                            }
                },
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(camera.name, style = MaterialTheme.typography.titleLarge)
        Text(camera.deviceName)
        Text(
            when {
                camera.privacyMode -> "Privacy on"
                camera.online -> "Online"
                else -> "Offline"
            },
            color = MaterialTheme.colorScheme.primary,
        )
        if (camera.viewerCount > 0) Text("${camera.viewerCount} watching")
        Text(
            when {
                camera.privacyMode -> "Unavailable while privacy is on"
                !camera.online -> "Waiting for camera"
                else -> "Tap to view live"
            },
            style = MaterialTheme.typography.bodySmall,
        )
        if (reordering) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    enabled = canMoveEarlier,
                    onClick = onMoveEarlier,
                    modifier = Modifier.weight(1f),
                ) { Text("Earlier") }
                OutlinedButton(
                    enabled = canMoveLater,
                    onClick = onMoveLater,
                    modifier = Modifier.weight(1f),
                ) { Text("Later") }
            }
        }
    }
}

internal fun monitorColumnCount(widthDp: Float): Int =
    when {
        widthDp >= 840 -> 3
        widthDp >= 600 -> 2
        else -> 1
    }

internal data class MonitorHealth(
    val cameras: Int,
    val online: Int,
    val offline: Int,
    val live: Int,
    val viewers: Int,
)

internal fun monitorHealth(cameras: List<BeaconApi.MonitorCamera>): MonitorHealth =
    MonitorHealth(
        cameras = cameras.size,
        online = cameras.count { it.online },
        offline = cameras.count { !it.online },
        live = cameras.count { it.viewerCount > 0 },
        viewers = cameras.sumOf { it.viewerCount },
    )

internal fun monitorVisibleCameras(
    cameras: List<BeaconApi.MonitorCamera>,
    favoriteCameraIds: Set<String>,
    favoritesOnly: Boolean,
): List<BeaconApi.MonitorCamera> =
    cameras.filter { !favoritesOnly || it.id in favoriteCameraIds }

@Composable
private fun AndroidLiveView(
    camera: BeaconApi.MonitorCamera,
    sessionToken: String,
    onBack: () -> Unit,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
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
            AndroidView(
                factory = {
                    (renderer.parent as? ViewGroup)?.removeView(renderer)
                    renderer
                },
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
                    Text(if (listening) "Mute" else "Listen")
                }
                Button(onClick = { fullscreen = false }) { Text("Exit full screen") }
            }
        }
        return
    }

    val compactViewer = LocalConfiguration.current.screenHeightDp < 600
    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedButton(onClick = onBack) { Text("Back") }
            Column {
                Text(camera.name, style = MaterialTheme.typography.titleLarge)
                Text(camera.deviceName, style = MaterialTheme.typography.bodySmall)
                Text(
                    "${camera.viewerCount} ${if (camera.viewerCount == 1) "viewer" else "viewers"}",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        AndroidView(
            factory = {
                (renderer.parent as? ViewGroup)?.removeView(renderer)
                renderer
            },
            modifier =
                Modifier.fillMaxWidth()
                    .height(if (compactViewer) 220.dp else 360.dp)
                    .background(Color.Black, RoundedCornerShape(16.dp))
                    .semantics { contentDescription = "Live video from ${camera.name}" },
        )
        Text(
            viewerStatusText(state, reconnectAttempt),
            color =
                if (state == StreamingState.Connected) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
        )
        if (reconnectAttempt > 0 && state != StreamingState.Connected) {
            Text("Reconnect attempt $reconnectAttempt", style = MaterialTheme.typography.bodySmall)
        }
        OutlinedButton(
            enabled = state == StreamingState.Connected,
            onClick = {
                listening = !listening
                viewerSession?.setListening(listening)
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (listening) "Mute" else "Listen")
        }
        OutlinedButton(
            enabled = state == StreamingState.Connected,
            onClick = { fullscreen = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Full screen")
        }
        OutlinedButton(onClick = onFavorite, modifier = Modifier.fillMaxWidth()) {
            Text(if (favorite) "Remove from favorites" else "Add to favorites")
        }
        if (onPrevious != null || onNext != null) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    enabled = onPrevious != null,
                    onClick = { onPrevious?.invoke() },
                ) {
                    Text("Previous")
                }
                Button(
                    enabled = onNext != null,
                    onClick = { onNext?.invoke() },
                ) {
                    Text("Next")
                }
            }
        }
    }
}

internal fun shouldRunNativeViewer(lifecycleStarted: Boolean): Boolean = lifecycleStarted

@Composable
private fun BeaconDestinationSwitcher(
    monitorSelected: Boolean,
    onCamera: () -> Unit,
    onMonitor: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(
        modifier =
            modifier.fillMaxWidth().semantics {
                contentDescription =
                    if (monitorSelected) "Monitor selected" else "Camera selected"
            },
    ) {
        val itemWidth = (maxWidth - 8.dp) / 2
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (monitorSelected) {
                OutlinedButton(onClick = onCamera, modifier = Modifier.width(itemWidth)) {
                    Text("Camera")
                }
                Button(onClick = onMonitor, modifier = Modifier.width(itemWidth)) {
                    Text("Monitor")
                }
            } else {
                Button(onClick = onCamera, modifier = Modifier.width(itemWidth)) {
                    Text("Camera")
                }
                OutlinedButton(onClick = onMonitor, modifier = Modifier.width(itemWidth)) {
                    Text("Monitor")
                }
            }
        }
    }
}

@Composable
private fun BeaconTheme(
    darkCameraSurface: Boolean,
    content: @Composable () -> Unit,
) {
    val light =
        lightColorScheme(
            primary = Color(0xFF176B57),
            onPrimary = Color.White,
            primaryContainer = Color(0xFFDFF1EB),
            onPrimaryContainer = Color(0xFF113D32),
            background = Color(0xFFF4F7F6),
            surface = Color.White,
            onSurface = Color(0xFF14231F),
            error = Color(0xFFA33B43),
        )
    val dark =
        darkColorScheme(
            primary = Color(0xFF6BD0B2),
            onPrimary = Color(0xFF07382C),
            primaryContainer = Color(0xFF184A3D),
            background = Color(0xFF0B1513),
            surface = Color(0xFF12201D),
            onSurface = Color(0xFFEDF6F3),
            error = Color(0xFFEF8D94),
        )
    MaterialTheme(
        colorScheme = if (darkCameraSurface) dark else light,
        content = content,
    )
}

@Composable
private fun PairingScreen(
    pairingCode: String,
    message: String,
    busy: Boolean,
    onCodeChange: (String) -> Unit,
    onScan: () -> Unit,
    onPair: () -> Unit,
    onBack: () -> Unit,
) {
    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
        verticalArrangement = Arrangement.Top,
    ) {
        OutlinedButton(onClick = onBack) { Text("Back") }
        Text(
            "Set up Camera",
            style = MaterialTheme.typography.headlineLarge,
            modifier = Modifier.padding(top = 20.dp),
        )
        Text(
            "On another device, open Beacon and choose Add camera.",
            modifier = Modifier.padding(vertical = 12.dp),
        )
        Button(
            enabled = !busy,
            onClick = onScan,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Scan QR code")
        }
        Text(
            "or enter the pairing code",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(vertical = 12.dp),
        )
        OutlinedTextField(
            value = pairingCode,
            onValueChange = onCodeChange,
            label = { Text("Pairing code") },
            supportingText =
                if (pairingCode.isNotBlank() && !isValidPairingCode(pairingCode)) {
                    { Text("Enter the 10-character code shown in Beacon.") }
                } else {
                    null
                },
            isError = pairingCode.isNotBlank() && !isValidPairingCode(pairingCode),
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        OutlinedButton(
            enabled = isValidPairingCode(pairingCode) && !busy,
            onClick = onPair,
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Text(if (busy) "Pairing…" else "Pair device")
        }
        if (message.isNotBlank()) Text(message, modifier = Modifier.padding(top = 12.dp))
    }
}

@Composable
private fun WelcomeScreen(
    onCameraSetup: () -> Unit,
    onMonitor: () -> Unit,
) {
    val compact = LocalConfiguration.current.screenHeightDp < 600
    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = if (compact) 12.dp else 32.dp),
        verticalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 16.dp),
    ) {
        Text("Beacon", color = MaterialTheme.colorScheme.primary)
        Text(
            "Welcome to Beacon",
            style =
                if (compact) MaterialTheme.typography.headlineMedium
                else MaterialTheme.typography.headlineLarge,
        )
        Text(
            "Use this phone as a camera, or sign in to watch cameras you already own.",
            style = MaterialTheme.typography.bodyLarge,
        )
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(if (compact) 12.dp else 20.dp),
                verticalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 8.dp),
            ) {
                Text(
                    "Turn this phone into a camera",
                    style =
                        if (compact) MaterialTheme.typography.titleMedium
                        else MaterialTheme.typography.titleLarge,
                )
                Text("Pair it in a few steps. Camera and microphone use always stay visible.")
                Button(onClick = onCameraSetup, modifier = Modifier.fillMaxWidth()) {
                    Text("Set up Camera")
                }
            }
        }
        OutlinedButton(onClick = onMonitor, modifier = Modifier.fillMaxWidth()) {
            Text("Sign in to Monitor")
        }
        Text(
            "No recording or hidden capture.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
        )
    }
}

private val pairingCodePattern = Regex("[A-HJ-NP-Z2-9]{10}")

internal fun normalizePairingCodeInput(value: String): String =
    value.trim().uppercase().filter(Char::isLetterOrDigit).take(10)

internal fun isValidPairingCode(value: String): Boolean = pairingCodePattern.matches(value)

internal fun parsePairingQr(rawValue: String?, trustedApiUrl: String? = null): String? {
    if (rawValue == null) return null
    val normalized = rawValue.trim().uppercase()
    if (isValidPairingCode(normalized)) return normalized
    Regex("^BEACON://PAIR\\?CODE=([A-HJ-NP-Z2-9]{10})$")
        .matchEntire(normalized)
        ?.groupValues
        ?.get(1)
        ?.let { return it }

    val link = runCatching { java.net.URI(rawValue.trim()) }.getOrNull() ?: return null
    val trustedHost = trustedApiUrl?.let { runCatching { java.net.URI(it).host }.getOrNull() }
    if (
        !link.scheme.equals("https", ignoreCase = true) ||
        trustedHost == null ||
        !link.host.equals(trustedHost, ignoreCase = true) ||
        link.path != "/pair"
    ) {
        return null
    }
    val code =
        link.rawQuery
            ?.split('&')
            ?.firstOrNull { it.substringBefore('=').equals("code", ignoreCase = true) }
            ?.substringAfter('=', missingDelimiterValue = "")
    return code?.trim()?.uppercase()?.takeIf(::isValidPairingCode)
}

internal fun parseMobileGoogleAuthLink(rawValue: String?, trustedApiUrl: String?): String? {
    if (rawValue == null) return null
    val link = runCatching { java.net.URI(rawValue.trim()) }.getOrNull() ?: return null
    val trustedHost = trustedApiUrl?.let { runCatching { java.net.URI(it).host }.getOrNull() }
    if (
        !link.scheme.equals("https", ignoreCase = true) ||
        trustedHost == null ||
        !link.host.equals(trustedHost, ignoreCase = true) ||
        link.path != "/auth/mobile"
    ) {
        return null
    }
    val code =
        link.rawFragment
            ?.split('&')
            ?.firstOrNull { it.substringBefore('=').equals("code", ignoreCase = true) }
            ?.substringAfter('=', missingDelimiterValue = "")
    return code?.takeIf { it.length in 32..512 && it.matches(Regex("[A-Za-z0-9_-]+")) }
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
    microphonePermission: Boolean,
    onAllowCamera: () -> Unit,
    onAllowNotifications: () -> Unit,
    onAllowMicrophone: () -> Unit,
    onPrivacy: () -> Unit,
    onSelectCamera: (String) -> Unit,
    onPairNewAccount: () -> Unit,
    onMonitor: () -> Unit,
) {
    val context = LocalContext.current
    var detailsExpanded by remember { mutableStateOf(false) }
    val battery =
        remember {
            val manager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        }
    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier.fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
        Text("Beacon Camera", style = MaterialTheme.typography.headlineLarge)
        Row(
            modifier =
                Modifier.fillMaxWidth()
                    .background(
                        MaterialTheme.colorScheme.primaryContainer,
                        RoundedCornerShape(16.dp),
                    )
                    .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text("Android Camera", style = MaterialTheme.typography.titleLarge)
                Text(
                    when {
                        runtime.privacyMode -> "PRIVACY ON"
                        runtime.device == DeviceLifecycle.Streaming -> "VIEWED LIVE"
                        runtime.device == DeviceLifecycle.Idle ||
                            runtime.device == DeviceLifecycle.Online -> "ONLINE"
                        runtime.device == DeviceLifecycle.Reconnecting -> "RECONNECTING"
                        else -> runtime.device.name.uppercase()
                    },
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Text("$battery% battery")
        }
        if (runtime.privacyMode) {
            Text("● PRIVACY · Camera and microphone off", color = MaterialTheme.colorScheme.primary)
        } else if (runtime.activeViewers > 0) {
            Text(
                "● LIVE · ${runtime.activeViewers} viewer${if (runtime.activeViewers == 1) "" else "s"}",
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.titleMedium,
            )
        } else {
            Text("● LIVE · Ready for viewers", color = MaterialTheme.colorScheme.primary)
        }
        if (shouldShowLocalPreview(runtime.privacyMode, CameraRuntime.previewView != null)) {
            Box(
                modifier =
                    Modifier.fillMaxWidth()
                        .height(260.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .semantics { contentDescription = "Live camera preview" },
            ) {
                AndroidView(
                    factory = {
                        (CameraRuntime.previewView
                                ?: PreviewView(it).apply {
                                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                                })
                            .also { preview ->
                                preview.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                                // The foreground service outlives Activity recreation. Detach its preview
                                // from a stale Compose host before attaching it to the new screen.
                                (preview.parent as? ViewGroup)?.removeView(preview)
                            }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        } else {
            Column(
                modifier =
                    Modifier.fillMaxWidth()
                        .height(180.dp)
                        .background(Color(0xFF101820), RoundedCornerShape(12.dp)),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    if (runtime.privacyMode) "Privacy is on" else "Starting live preview…",
                    color = Color.White,
                )
                if (runtime.privacyMode) {
                    Text(
                        "Camera and microphone are off on this phone.",
                        color = Color.White,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        if (runtime.batteryOptimizationRestricted) {
            Text(
                "Allow unrestricted battery use for reliable background camera.",
            )
        }
        if (runtime.cameras.size > 1) {
            Text("Camera source", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                runtime.cameras.forEach { camera ->
                    if (camera.id == runtime.selectedCameraId) {
                        Button(enabled = false, onClick = { onSelectCamera(camera.id) }) {
                            Text(camera.name)
                        }
                    } else {
                        OutlinedButton(
                            enabled =
                                canSwitchCameraSource(
                                    runtime.selectedCameraId,
                                    camera.id,
                                    runtime.sourceLifecycle,
                                    runtime.privacyMode,
                                ),
                            onClick = { onSelectCamera(camera.id) },
                        ) {
                            Text(camera.name)
                        }
                    }
                }
            }
            Text("Choose what this device watches.")
        }
        if (!cameraPermission) {
            Text(
                "Camera access is required.",
                color = MaterialTheme.colorScheme.error,
            )
            Button(onClick = onAllowCamera, modifier = Modifier.fillMaxWidth()) {
                Text("Allow camera")
            }
        } else if (!notificationPermission) {
            Text(
                "Allow notifications to keep Camera Mode visible.",
                color = MaterialTheme.colorScheme.error,
            )
            Button(onClick = onAllowNotifications, modifier = Modifier.fillMaxWidth()) {
                Text("Allow camera status notification")
            }
        } else if (!microphonePermission) {
            Text("Video is ready. Allow the microphone for audio.")
            Button(onClick = onAllowMicrophone, modifier = Modifier.fillMaxWidth()) {
                Text("Allow microphone for live listening")
            }
        }
        Button(
            onClick = onPrivacy,
            enabled = !runtime.privacyChangePending,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                when {
                    runtime.privacyChangePending -> "Updating privacy…"
                    runtime.privacyMode -> "Resume camera"
                    else -> "Turn privacy on"
                },
            )
        }
        if (runtime.privacySyncPending) {
            Text("Capture is off on this phone. Your household will update when the connection returns.")
        }
        OutlinedButton(
            onClick = { detailsExpanded = !detailsExpanded },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (detailsExpanded) "Hide device details" else "Device details")
        }
        if (detailsExpanded) {
            Column(
                modifier =
                    Modifier.fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp))
                        .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("Connection", style = MaterialTheme.typography.titleMedium)
                Text(runtime.diagnostic, style = MaterialTheme.typography.bodyMedium)
                if (runtime.retryAttempt > 0) {
                    Text("Reconnect attempt ${runtime.retryAttempt}")
                }
                OutlinedButton(onClick = onPairNewAccount, modifier = Modifier.fillMaxWidth()) {
                    Text("Move camera to another account")
                }
                Text(
                    "Moving this camera removes its current account connection. Your Monitor sign-in is unchanged.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        Text(
            "Beacon shows a persistent notification while Camera Mode is active.",
            style = MaterialTheme.typography.bodySmall,
        )
        }
        BeaconDestinationSwitcher(
            monitorSelected = false,
            onCamera = {},
            onMonitor = onMonitor,
            modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 16.dp),
        )
    }
}
