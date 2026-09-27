package com.beaconsecureview.camera

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Cameraswitch
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
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

@Composable
internal fun MonitorHome(
    api: BeaconApi,
    sessionStore: AccountSessionStore,
    cameraPaired: Boolean,
    onCameraMode: () -> Unit,
    onSetUpThisDevice: (String) -> Unit,
    onAccountDeleted: () -> Unit,
    inboundGoogleAuthCode: String?,
    onInboundGoogleAuthCodeHandled: () -> Unit,
    onGoogleSignIn: () -> Unit,
    themePreference: BeaconThemePreference,
    onThemePreferenceChange: (BeaconThemePreference) -> Unit,
) {
    val context = LocalContext.current
    var session by remember { mutableStateOf(sessionStore.read()) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    var cameras by remember { mutableStateOf<List<BeaconApi.MonitorCamera>>(emptyList()) }
    var selectedCameraId by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedSettingsDeviceId by rememberSaveable { mutableStateOf<String?>(null) }
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
    var monitorPage by rememberSaveable(session?.userId) { mutableStateOf(MonitorPage.Home) }
    var eventsView by rememberSaveable(session?.userId) { mutableStateOf(MonitorEventsView.Activity) }
    var navigationOpen by rememberSaveable(session?.userId) { mutableStateOf(false) }
    var accessEvents by remember(session?.userId) {
        mutableStateOf<List<BeaconApi.AccessEvent>>(emptyList())
    }
    var accessHistoryLoaded by remember(session?.userId) { mutableStateOf(false) }
    var accessHistoryPage by rememberSaveable(session?.userId) { mutableStateOf(0) }
    var motionRetentionDays by remember(session?.userId) { mutableStateOf<Int?>(null) }
    var savedMotionRetentionDays by remember(session?.userId) { mutableStateOf<Int?>(null) }
    var savingMotionRetention by remember { mutableStateOf(false) }
    var deviceControlBusy by remember { mutableStateOf(false) }
    var deleteAccountOpen by rememberSaveable { mutableStateOf(false) }
    var deletingAccount by remember { mutableStateOf(false) }
    var deleteAccountError by remember { mutableStateOf("") }
    var motionEvents by remember(session?.userId) {
        mutableStateOf<List<BeaconApi.MotionEvent>>(emptyList())
    }
    var motionEventsLoaded by remember(session?.userId) { mutableStateOf(false) }
    var cameraMotionSettings by remember(selectedSettingsDeviceId) {
        mutableStateOf<List<BeaconApi.CameraMotionSettings>>(emptyList())
    }
    var cameraMotionSettingsLoaded by remember(selectedSettingsDeviceId) { mutableStateOf(false) }
    var cameraMotionSettingsBusy by remember { mutableStateOf(false) }
    var cameraMotionSettingsError by remember(selectedSettingsDeviceId) { mutableStateOf("") }
    var cameraMotionSettingsNotice by remember(selectedSettingsDeviceId) { mutableStateOf("") }
    var recordings by remember(session?.userId) {
        mutableStateOf<List<BeaconApi.RecordingSummary>>(emptyList())
    }
    var recordingsLoaded by remember(session?.userId) { mutableStateOf(false) }
    var recordingsCursor by remember(session?.userId) { mutableStateOf<String?>(null) }
    var recordingBusyId by remember { mutableStateOf<String?>(null) }
    var recordingsLoadingMore by remember { mutableStateOf(false) }
    var recordingPlayback by remember { mutableStateOf<BeaconApi.PlaybackRecording?>(null) }
    var recordingDeleteTarget by remember { mutableStateOf<BeaconApi.RecordingSummary?>(null) }
    var recordingShareTarget by remember { mutableStateOf<BeaconApi.RecordingSummary?>(null) }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var notificationConsent by remember { mutableStateOf(NotificationConsentStore(context).enabled) }
    var notificationBusy by remember { mutableStateOf(false) }
    var notificationPreferences by remember(session?.userId) {
        mutableStateOf<List<BeaconApi.NotificationPreference>>(emptyList())
    }
    fun expireSession() {
        NotificationConsentStore(context).mute()
        notificationConsent = false
        scope.launch(Dispatchers.IO) {
            disableAndroidNotifications(context, api, null)
        }
        sessionStore.clear()
        session = null
        selectedCameraId = null
        cameras = emptyList()
        message = "Your session expired. Sign in again."
    }
    fun enableNotifications() {
        val active = session ?: return
        notificationBusy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { enableAndroidNotifications(context, api, active) }
            }
            result.onSuccess {
                notificationConsent = true
                message = "Notifications are on. Lock-screen details stay private."
            }.onFailure {
                // Unlike api.* failures (whose .message is our own backend's
                // error string), this comes from the Firebase Messaging SDK
                // directly -- its exception text is meant for logs, not
                // users, and has surfaced raw internal detail in practice.
                Log.w("BeaconLifecycle", "event=notification_enable_failed", it)
                message = "Notifications could not be enabled. Try again from Settings."
            }
            notificationBusy = false
        }
    }
    val alertPermissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) enableNotifications()
            else message = "Notifications were not allowed. You can change this in Android settings."
        }
    val monitorScrollState = rememberScrollState()
    val navigationPreferences =
        remember(context) { context.getSharedPreferences("beacon_navigation", Context.MODE_PRIVATE) }

    // Camera and microphone are only ever relevant once this phone is paired
    // as a camera (MainActivity already sequences those right after pairing);
    // a pure monitor/viewer session never touches either. Notifications are
    // the one permission the monitor role actually needs, so ask for it once
    // right at sign-in instead of leaving it undiscovered until someone
    // happens to open Settings and flips the switch themselves.
    LaunchedEffect(session?.userId) {
        val active = session ?: return@LaunchedEffect
        val key = "monitor_notification_permission_asked:${active.userId}"
        if (navigationPreferences.getBoolean(key, false)) return@LaunchedEffect
        navigationPreferences.edit().putBoolean(key, true).apply()
        if (notificationConsent) return@LaunchedEffect
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            alertPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            enableNotifications()
        }
    }

    LaunchedEffect(inboundGoogleAuthCode) {
        val code = inboundGoogleAuthCode ?: return@LaunchedEffect
        if (session == null) {
            busy = true
            val result =
                withContext(Dispatchers.IO) { runCatching { api.exchangeGoogleSignIn(code) } }
            result.onSuccess {
                sessionStore.save(it)
                session = it
                message = ""
            }.onFailure {
                message = it.userFacingMessage("Google sign-in could not be completed.")
            }
            busy = false
        }
        // Clearing this state before the awaited exchange would cancel this
        // LaunchedEffect and discard the successfully returned session.
        onInboundGoogleAuthCodeHandled()
    }

    fun refresh(token: String, showLoading: Boolean = cameras.isEmpty()) {
        if (showLoading) busy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { api.listMonitorCameras(token) } }
            result.onSuccess {
                selectedCameraId =
                    reconciledCameraId(
                        previousCameras = cameras,
                        refreshedCameras = it,
                        selectedCameraId = selectedCameraId,
                    )
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
                    expireSession()
                } else {
                    message = it.userFacingMessage("Cameras are temporarily unavailable")
                }
            }
            if (showLoading) busy = false
        }
    }

    LaunchedEffect(session, selectedCameraId) {
        val active = session ?: return@LaunchedEffect
        while (session == active) {
            refresh(active.token)
            delay(if (selectedCameraId == null) 15_000 else 1_000)
        }
    }

    LaunchedEffect(session?.token) {
        val active = session ?: return@LaunchedEffect
        val result = withContext(Dispatchers.IO) { runCatching { api.currentAccount(active.token) } }
        result.onSuccess {
            if (session?.token == active.token) {
                sessionStore.save(it)
                session = it
            }
        }.onFailure {
            if (it is AuthorizationLostException) {
                expireSession()
            }
        }
    }

    LaunchedEffect(selectedSettingsDeviceId, session?.token, session?.householdRole) {
        val deviceId = selectedSettingsDeviceId ?: return@LaunchedEffect
        val active = session ?: return@LaunchedEffect
        if (active.householdRole !in setOf("owner", "admin")) {
            cameraMotionSettingsLoaded = true
            return@LaunchedEffect
        }
        cameraMotionSettingsLoaded = false
        cameraMotionSettingsError = ""
        val result = withContext(Dispatchers.IO) { runCatching { api.monitorMotionSettings(active.token, deviceId) } }
        result.onSuccess {
            cameraMotionSettings = it
            cameraMotionSettingsLoaded = true
        }.onFailure {
            if (it is AuthorizationLostException) {
                expireSession()
            } else {
                cameraMotionSettingsError = it.userFacingMessage("Motion settings could not be loaded. Try again.")
            }
            cameraMotionSettingsLoaded = true
        }
    }

    LaunchedEffect(session, monitorPage, eventsView) {
        val active = session ?: return@LaunchedEffect
        when (monitorPage) {
            MonitorPage.Home -> {
                val result = withContext(Dispatchers.IO) { runCatching { api.motionEvents(active.token) } }
                result.onSuccess {
                    motionEvents = it
                    motionEventsLoaded = true
                }.onFailure {
                    message = it.userFacingMessage("Activity is temporarily unavailable")
                    motionEventsLoaded = true
                }
            }
            MonitorPage.Events -> if (eventsView == MonitorEventsView.Activity) {
                val result = withContext(Dispatchers.IO) { runCatching { api.motionEvents(active.token) } }
                result.onSuccess {
                    motionEvents = it
                    motionEventsLoaded = true
                }.onFailure {
                    message = it.userFacingMessage("Activity is temporarily unavailable")
                    motionEventsLoaded = true
                }
            } else {
                recordingsLoaded = false
                val result = withContext(Dispatchers.IO) { runCatching { api.recordings(active.token) } }
                result.onSuccess {
                    recordings = it.recordings
                    recordingsCursor = it.nextCursor
                    recordingsLoaded = true
                }.onFailure {
                    message = it.userFacingMessage("Clips are temporarily unavailable")
                    recordingsLoaded = true
                }
            }
            MonitorPage.Settings -> {
                val (historyResult, retentionResult, notificationResult) =
                    withContext(Dispatchers.IO) {
                        Triple(
                            runCatching { api.accessHistory(active.token) },
                            runCatching { api.motionRetention(active.token) },
                            runCatching { api.notificationPreferences(active.token) },
                        )
                    }
                historyResult.onSuccess {
                    accessEvents = it
                    accessHistoryLoaded = true
                }.onFailure {
                    message = it.userFacingMessage("Access history is temporarily unavailable")
                    accessHistoryLoaded = true
                }
                retentionResult.onSuccess {
                    motionRetentionDays = it
                    savedMotionRetentionDays = it
                }.onFailure {
                    message = it.userFacingMessage("Motion history settings are temporarily unavailable")
                }
                notificationResult.onSuccess { notificationPreferences = it }
                    .onFailure { message = it.userFacingMessage("Notification preferences are temporarily unavailable") }
            }
            else -> Unit
        }
    }

    LaunchedEffect(monitorPage) { monitorScrollState.scrollTo(0) }

    val activeSession = session
    val orderByCameraId = cameraOrderIds.withIndex().associate { it.value to it.index }
    val orderedCameras =
        monitorHostCameras(cameras).sortedBy { orderByCameraId[it.id] ?: Int.MAX_VALUE }
    val activeCamera = orderedCameras.find { it.id == selectedCameraId }
    if (activeSession != null && activeCamera != null) {
        val activeIndex = orderedCameras.indexOfFirst { it.id == activeCamera.id }
        val alternateSource = nextCameraSource(cameras, activeCamera)
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
            onFlip =
                alternateSource?.let { target ->
                    {
                        scope.launch {
                            val result =
                                withContext(Dispatchers.IO) {
                                    runCatching { api.activateCamera(activeSession.token, target.id) }
                                }
                            result.onSuccess {
                                selectedCameraId = target.id
                                delay(650)
                                refresh(activeSession.token, showLoading = false)
                            }.onFailure {
                                message = it.userFacingMessage("Could not switch camera")
                            }
                        }
                    }
                },
            flipLabel = alternateSource?.name,
            onAuthorizationLost = {
                NotificationConsentStore(context).mute()
                notificationConsent = false
                scope.launch(Dispatchers.IO) {
                    disableAndroidNotifications(context, api, null)
                }
                sessionStore.clear()
                session = null
                selectedCameraId = null
                cameras = emptyList()
                message = "Your session expired. Sign in again."
            },
            canRecord = activeSession.householdRole == "owner",
            favorite = activeCamera.id in favoriteCameraIds,
            onFavorite = {
                favoriteCameraIds = favoritesStore.toggle(activeSession.userId, activeCamera.id)
            },
        )
        return
    }

    BackHandler(enabled = selectedSettingsDeviceId != null) {
        selectedSettingsDeviceId = null
    }
    BackHandler(enabled = navigationOpen) { navigationOpen = false }

    // Android's conventional phone/tablet breakpoint. Below it, Beacon uses the
    // PWA's mobile drawer (BeaconMonitorTopBar + BeaconMonitorNavigation, unchanged
    // below); at or above it, a permanent sidebar sits beside the content instead,
    // mirroring the PWA's own wide-layout behavior instead of stretching the
    // phone-width drawer across a tablet or unfolded foldable.
    val isWideLayout = LocalConfiguration.current.screenWidthDp >= BEACON_WIDE_LAYOUT_MIN_WIDTH_DP

    Row(modifier = Modifier.fillMaxSize()) {
        if (isWideLayout && session != null) {
            BeaconPermanentSidebar(
                selected = monitorPage,
                email = session!!.email ?: "Beacon account",
                themePreference = themePreference,
                onSelect = {
                    monitorPage = it
                    if (it != MonitorPage.Cameras) selectedSettingsDeviceId = null
                },
                onThemePreferenceChange = onThemePreferenceChange,
                onTrustAndPrivacy = { monitorPage = MonitorPage.Settings },
                onLogout = {
                    val active = session
                    if (active != null) {
                        NotificationConsentStore(context).mute()
                        notificationConsent = false
                        sessionStore.clear()
                        session = null
                        selectedCameraId = null
                        cameras = emptyList()
                        monitorPage = MonitorPage.Home
                        scope.launch(Dispatchers.IO) {
                            runCatching { disableAndroidNotifications(context, api, active) }
                            runCatching { api.logout(active.token) }
                        }
                    }
                },
            )
            Box(
                modifier =
                    Modifier.width(1.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outlineVariant),
            )
        }
        Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
        Column(modifier = Modifier.fillMaxSize()) {
            if (session != null && !isWideLayout) {
                BeaconMonitorTopBar(onOpenNavigation = { navigationOpen = true })
            }
            Column(
                modifier =
                    Modifier.fillMaxWidth()
                        .weight(1f)
                        .verticalScroll(monitorScrollState)
                        .then(if (session == null) Modifier.safeDrawingPadding() else Modifier.navigationBarsPadding())
                        .padding(horizontal = 16.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
        if (session == null) {
            MonitorAuthScreen(
                email = email,
                password = password,
                showPassword = showPassword,
                busy = busy,
                message = message,
                onEmailChange = {
                    email = it
                    message = ""
                },
                onPasswordChange = {
                    password = it
                    message = ""
                },
                onShowPasswordChange = { showPassword = it },
                onSignIn = {
                    if (email.isBlank() || password.isBlank()) {
                        message = "Enter your email and password."
                    } else {
                        busy = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.login(email, password) } }
                            result.onSuccess {
                                sessionStore.save(it)
                                password = ""
                                session = it
                                message = ""
                            }.onFailure { message = it.userFacingMessage("Sign in failed") }
                            busy = false
                        }
                    }
                },
                onCreateAccount = {
                    busy = true
                    scope.launch {
                        val result = withContext(Dispatchers.IO) { runCatching { api.createAccount(email, password) } }
                        result.onSuccess {
                            sessionStore.save(it)
                            password = ""
                            session = it
                            message = ""
                        }.onFailure { message = it.userFacingMessage("Account could not be created") }
                        busy = false
                    }
                },
                onGoogleSignIn = onGoogleSignIn,
                onCameraMode = onCameraMode,
                requestPasswordReset = { resetEmail ->
                    withContext(Dispatchers.IO) { runCatching { api.requestPasswordReset(resetEmail) } }
                },
            )
        } else {
            // A stable snapshot, not repeated `session!!` reads: this branch
            // only runs while session is non-null, but the callbacks below
            // launch coroutines that can resume after a concurrent background
            // refresh has already cleared `session` on authorization loss.
            // Capturing it once here means those callbacks keep working with
            // the session they started with instead of risking a null-pointer
            // crash.
            val currentSession = session!!
            when (monitorPage) {
                MonitorPage.Home -> {
                    BeaconHeroPanel(modifier = Modifier.fillMaxWidth()) {
                        Text("HOME", color = BeaconActionBright, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                        Text(homeHeadline(cameras), color = Color.White, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
                        Text(homeSupportingText(cameras), color = BeaconHeroSupporting)
                        Spacer(Modifier.height(16.dp))
                        Button(
                            onClick = { monitorPage = MonitorPage.Cameras },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = BeaconActionBright, contentColor = Color(0xFF04101C)),
                        ) { Text(if (cameras.isEmpty()) "Add or view cameras" else "View all cameras") }
                    }
                    if (cameras.isNotEmpty()) {
                        val health = monitorHealth(monitorHostCameras(cameras))
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            BeaconMetric(health.online.toString(), "Ready to view", Icons.Outlined.Videocam, BeaconOnline, Modifier.weight(1f))
                            BeaconMetric(health.viewers.toString(), "Watching now", Icons.Outlined.Visibility, BeaconLive, Modifier.weight(1f))
                        }
                        BeaconPageHeader("Your cameras", "Around your home")
                        MonitorCameraGrid(
                            cameras = orderedCameras.take(2),
                            onView = { selectedCameraId = it.id },
                        )
                    }
                    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Latest activity", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            androidx.compose.material3.TextButton(onClick = {
                                monitorPage = MonitorPage.Events
                                eventsView = MonitorEventsView.Activity
                            }) {
                                Text("See all")
                            }
                        }
                        when {
                            !motionEventsLoaded -> Text("Loading activity…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            motionEvents.isEmpty() -> Text(
                                "Motion events will appear here after you connect a camera.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            else -> motionEvents.take(3).forEach { event -> MotionEventPreviewRow(event) }
                        }
                    }
                }
                MonitorPage.Cameras -> {
                    val settingsSources =
                        selectedSettingsDeviceId?.let { deviceId ->
                            cameras.filter { it.deviceId == deviceId }
                        }.orEmpty()
                    if (selectedSettingsDeviceId != null && settingsSources.isNotEmpty()) {
                        MonitorDeviceSettings(
                            sources = settingsSources,
                            busy = deviceControlBusy,
                            onBack = { selectedSettingsDeviceId = null },
                            onView = { selectedCameraId = it.id },
                            onActivate = { target ->
                                deviceControlBusy = true
                                scope.launch {
                                    val result =
                                        withContext(Dispatchers.IO) {
                                            runCatching { api.activateCamera(currentSession.token, target.id) }
                                        }
                                    result.onSuccess {
                                        delay(650)
                                        refresh(currentSession.token, showLoading = false)
                                        message = "${target.name} is now active."
                                    }.onFailure {
                                        message = it.userFacingMessage("Could not switch camera")
                                    }
                                    deviceControlBusy = false
                                }
                            },
                            onPrivacyChange = { enabled ->
                                val deviceId = settingsSources.first().deviceId
                                deviceControlBusy = true
                                scope.launch {
                                    val result =
                                        withContext(Dispatchers.IO) {
                                            runCatching {
                                                api.setDevicePrivacy(currentSession.token, deviceId, enabled)
                                            }
                                        }
                                    result.onSuccess {
                                        delay(400)
                                        refresh(currentSession.token, showLoading = false)
                                        message =
                                            if (enabled) "Privacy mode enabled. Capture stopped."
                                            else "Privacy mode disabled. Camera available again."
                                    }.onFailure {
                                        message = it.userFacingMessage("Could not change privacy mode")
                                    }
                                    deviceControlBusy = false
                                }
                            },
                            motionContent = {
                                if (currentSession.householdRole in setOf("owner", "admin")) {
                                    AndroidMotionSettingsPanel(
                                        sources = settingsSources,
                                        settings = cameraMotionSettings,
                                        loaded = cameraMotionSettingsLoaded,
                                        busy = cameraMotionSettingsBusy,
                                        error = cameraMotionSettingsError,
                                        notice = cameraMotionSettingsNotice,
                                        onChange = { changed ->
                                            cameraMotionSettings =
                                                cameraMotionSettings.map { if (it.cameraId == changed.cameraId) changed else it }
                                            cameraMotionSettingsError = ""
                                            cameraMotionSettingsNotice = ""
                                        },
                                        onSave = { changed ->
                                            cameraMotionSettingsBusy = true
                                            cameraMotionSettingsError = ""
                                            cameraMotionSettingsNotice = ""
                                            scope.launch {
                                                val result =
                                                    withContext(Dispatchers.IO) {
                                                        runCatching { api.updateMonitorMotionSettings(currentSession.token, changed) }
                                                    }
                                                result.onSuccess { saved ->
                                                    cameraMotionSettings =
                                                        cameraMotionSettings.map { if (it.cameraId == saved.cameraId) saved else it }
                                                    cameraMotionSettingsNotice =
                                                        "Saved. Your phone applies the settings on its next connection check."
                                                }.onFailure {
                                                    if (it is AuthorizationLostException) {
                                                        expireSession()
                                                    } else {
                                                        cameraMotionSettingsError =
                                                            it.userFacingMessage("Changes could not be saved. Your edits are still here to retry.")
                                                    }
                                                }
                                                cameraMotionSettingsBusy = false
                                            }
                                        },
                                        onRetry = {
                                            val deviceId = settingsSources.first().deviceId
                                            cameraMotionSettingsLoaded = false
                                            cameraMotionSettingsError = ""
                                            scope.launch {
                                                val result =
                                                    withContext(Dispatchers.IO) {
                                                        runCatching { api.monitorMotionSettings(currentSession.token, deviceId) }
                                                    }
                                                result.onSuccess { cameraMotionSettings = it }
                                                    .onFailure {
                                                        if (it is AuthorizationLostException) {
                                                            expireSession()
                                                        } else {
                                                            cameraMotionSettingsError =
                                                                it.userFacingMessage("Motion settings could not be loaded. Try again.")
                                                        }
                                                    }
                                                cameraMotionSettingsLoaded = true
                                            }
                                        },
                                    )
                                }
                            },
                        )
                    } else {
                        BeaconPageHeader(
                            eyebrow = "Beacon / your household",
                            title = "Cameras",
                            supportingText = "Find a camera and watch it live.",
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { refresh(currentSession.token, true) }) {
                                Icon(Icons.Outlined.Refresh, null, modifier = Modifier.size(18.dp))
                                Text("Refresh", modifier = Modifier.padding(start = 6.dp))
                            }
                            if (favoriteCameraIds.isNotEmpty()) {
                                OutlinedButton(onClick = { favoritesOnly = !favoritesOnly }) {
                                    Text(if (favoritesOnly) "All" else "Favorites")
                                }
                            }
                            if (orderedCameras.size > 1 && !favoritesOnly) {
                                OutlinedButton(onClick = { reordering = !reordering }) {
                                    Text(if (reordering) "Done" else "Reorder")
                                }
                            }
                        }
                        if (busy) Text("Loading cameras…")
                        val visibleCameras = monitorVisibleCameras(orderedCameras, favoriteCameraIds, favoritesOnly)
                        if (!busy && visibleCameras.isEmpty()) {
                            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                                Text("No cameras yet", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                Text("Use Camera mode on a phone, tablet, laptop, or browser to add one.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Button(
                                    onClick = { onSetUpThisDevice(currentSession.token) },
                                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                                ) { Text(if (cameraPaired) "Open Camera mode" else "Set up this device") }
                            }
                        }
                        MonitorCameraGrid(
                            cameras = visibleCameras,
                            reordering = reordering,
                            onView = { selectedCameraId = it.id },
                            onSettings = { selectedSettingsDeviceId = it.deviceId },
                            onMove = { camera, direction ->
                                val updated = movedCameraId(cameraOrderIds, camera.id, direction)
                                cameraOrderIds = updated
                                orderStore.write(currentSession.userId, updated)
                            },
                        )
                    }
                }
                MonitorPage.Events -> {
                    BeaconEventsViewSwitch(selected = eventsView, onSelect = { eventsView = it })
                    if (eventsView == MonitorEventsView.Activity) {
                        BeaconPageHeader(
                            eyebrow = "On-device detection",
                            title = "Motion events",
                            supportingText = "Camera, time, and motion intensity—never an image or recording.",
                        )
                        if (!motionEventsLoaded) Text("Loading activity…")
                        if (motionEventsLoaded && motionEvents.isEmpty()) {
                            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                                Text("No activity yet", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                Text("Motion events will appear here after you connect a camera.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        motionEvents.forEach { event -> MotionEventRow(event) }
                    } else {
                        AndroidRecordingLibrary(
                        api = api,
                        sessionToken = currentSession.token,
                        recordings = recordings,
                        loaded = recordingsLoaded,
                        loadingMore = recordingsLoadingMore,
                        nextCursor = recordingsCursor,
                        busyRecordingId = recordingBusyId,
                        canDelete = currentSession.householdRole == "owner",
                        playback = recordingPlayback,
                        deleteTarget = recordingDeleteTarget,
                        shareTarget = recordingShareTarget,
                        onRefresh = {
                            recordingsLoaded = false
                            scope.launch {
                                val result = withContext(Dispatchers.IO) { runCatching { api.recordings(currentSession.token) } }
                                result.onSuccess {
                                    recordings = it.recordings
                                    recordingsCursor = it.nextCursor
                                    message = ""
                                }.onFailure { message = it.userFacingMessage("Clips are temporarily unavailable") }
                                recordingsLoaded = true
                            }
                        },
                        onLoadMore = {
                            val cursor = recordingsCursor ?: return@AndroidRecordingLibrary
                            recordingsLoadingMore = true
                            scope.launch {
                                val result = withContext(Dispatchers.IO) { runCatching { api.recordings(currentSession.token, cursor) } }
                                result.onSuccess {
                                    recordings = recordings + it.recordings
                                    recordingsCursor = it.nextCursor
                                }.onFailure { message = it.userFacingMessage("More clips could not be loaded") }
                                recordingsLoadingMore = false
                            }
                        },
                        onPlay = { recording ->
                            recordingPlayback?.file?.delete()
                            recordingPlayback = null
                            recordingBusyId = recording.id
                            scope.launch {
                                val result =
                                    withContext(Dispatchers.IO) {
                                        runCatching {
                                            api.downloadRecordingForPlayback(
                                                currentSession.token,
                                                recording.id,
                                                context.cacheDir,
                                            )
                                        }
                                    }
                                result.onSuccess { recordingPlayback = it }
                                    .onFailure { message = it.userFacingMessage("Clip could not be played") }
                                recordingBusyId = null
                            }
                        },
                        onRequestDelete = { recordingDeleteTarget = it },
                        onConfirmDelete = {
                            val target = recordingDeleteTarget ?: return@AndroidRecordingLibrary
                            recordingBusyId = target.id
                            scope.launch {
                                val result = withContext(Dispatchers.IO) { runCatching { api.deleteRecording(currentSession.token, target.id) } }
                                result.onSuccess {
                                    recordings = recordings.filterNot { it.id == target.id }
                                    recordingPlayback?.file?.delete()
                                    recordingPlayback = null
                                    recordingDeleteTarget = null
                                }.onFailure { message = it.userFacingMessage("Clip could not be deleted") }
                                recordingBusyId = null
                            }
                        },
                        onCancelDelete = { recordingDeleteTarget = null },
                        onClosePlayback = {
                            recordingPlayback?.file?.delete()
                            recordingPlayback = null
                        },
                        onRequestShare = { recordingShareTarget = it },
                        onDismissShare = { recordingShareTarget = null },
                        )
                    }
                }
                MonitorPage.Settings -> {
                    BeaconPageHeader(
                        eyebrow = "Beacon / account",
                        title = "Settings",
                        supportingText = "Manage alerts, household data, and your account.",
                    )
                    BeaconSectionHeader("Notifications", "Control private alerts from this phone.")
                    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                        Text("Private camera alerts", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(
                            "Motion and availability alerts never include camera names, images, or recordings.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Button(
                            enabled = !notificationBusy,
                            onClick = {
                                if (notificationConsent) {
                                    val active = session
                                    NotificationConsentStore(context).mute()
                                    notificationConsent = false
                                    notificationBusy = true
                                    scope.launch {
                                        withContext(Dispatchers.IO) { disableAndroidNotifications(context, api, active) }
                                        notificationBusy = false
                                        message = "Notifications are off on this device."
                                    }
                                } else if (
                                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                                        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                                ) {
                                    alertPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                } else {
                                    enableNotifications()
                                }
                            },
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        ) { Text(if (notificationBusy) "Updating…" else if (notificationConsent) "Turn off notifications" else "Turn on notifications") }
                        notificationPreferences.forEach { preference ->
                            Text(preference.deviceName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 14.dp))
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Text("Motion alerts", modifier = Modifier.weight(1f))
                                Switch(
                                    checked = preference.motionEnabled,
                                    enabled = !notificationBusy,
                                    modifier = Modifier.semantics { contentDescription = "Motion alerts for ${preference.deviceName}" },
                                    onCheckedChange = { checked ->
                                        val changed = preference.copy(motionEnabled = checked)
                                        notificationPreferences = notificationPreferences.map { if (it.deviceId == changed.deviceId) changed else it }
                                        notificationBusy = true
                                        scope.launch {
                                            val result = withContext(Dispatchers.IO) { runCatching { api.updateNotificationPreference(currentSession.token, changed) } }
                                            result.onSuccess { saved -> notificationPreferences = notificationPreferences.map { if (it.deviceId == saved.deviceId) saved else it } }
                                                .onFailure { message = it.userFacingMessage("Notification preferences could not be saved") }
                                            notificationBusy = false
                                        }
                                    },
                                )
                            }
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Text("Offline and recovery alerts", modifier = Modifier.weight(1f))
                                Switch(
                                    checked = preference.offlineEnabled,
                                    enabled = !notificationBusy,
                                    modifier = Modifier.semantics { contentDescription = "Offline and recovery alerts for ${preference.deviceName}" },
                                    onCheckedChange = { checked ->
                                        val changed = preference.copy(offlineEnabled = checked)
                                        notificationPreferences = notificationPreferences.map { if (it.deviceId == changed.deviceId) changed else it }
                                        notificationBusy = true
                                        scope.launch {
                                            val result = withContext(Dispatchers.IO) { runCatching { api.updateNotificationPreference(currentSession.token, changed) } }
                                            result.onSuccess { saved -> notificationPreferences = notificationPreferences.map { if (it.deviceId == saved.deviceId) saved else it } }
                                                .onFailure { message = it.userFacingMessage("Notification preferences could not be saved") }
                                            notificationBusy = false
                                        }
                                    },
                                )
                            }
                        }
                    }
                    BeaconSectionHeader("This device", "Use this phone as a visible Beacon camera.")
                    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                        Text("Camera mode", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text("Switch this phone into visible Camera mode.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Button(
                            onClick = { onSetUpThisDevice(currentSession.token) },
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        ) {
                            Icon(Icons.Outlined.Smartphone, null, modifier = Modifier.size(18.dp))
                            Text(
                                if (cameraPaired) "Open Camera mode" else "Set up this device",
                                modifier = Modifier.padding(start = 7.dp),
                            )
                        }
                    }
                    BeaconSectionHeader("Security", "Review recent access to your cameras.")
                    if (!accessHistoryLoaded) Text("Loading access history…")
                    if (accessHistoryLoaded && accessEvents.isEmpty()) {
                        Text("No recent camera access.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (accessEvents.isNotEmpty()) {
                        val pageSize = 5
                        val pageCount = (accessEvents.size + pageSize - 1) / pageSize
                        val page = accessHistoryPage.coerceIn(0, pageCount - 1)
                        accessEvents.drop(page * pageSize).take(pageSize).forEach { event ->
                            AccessEventRow(event, currentSession.email)
                        }
                        if (pageCount > 1) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                androidx.compose.material3.TextButton(
                                    enabled = page > 0,
                                    onClick = { accessHistoryPage = page - 1 },
                                ) { Text("Previous") }
                                Text("Page ${page + 1} of $pageCount", style = MaterialTheme.typography.labelLarge)
                                androidx.compose.material3.TextButton(
                                    enabled = page < pageCount - 1,
                                    onClick = { accessHistoryPage = page + 1 },
                                ) { Text("Next") }
                            }
                        }
                    }
                    BeaconSectionHeader("Data & storage", "Choose how long motion metadata is kept.")
                    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                        Text("Motion history", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(
                            "Beacon stores motion time, camera name, and intensity—not recordings, images, or audio.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (motionRetentionDays == null) {
                            Text("Loading retention setting…", modifier = Modifier.padding(top = 12.dp))
                        } else {
                            Text("Keep motion history for", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 14.dp, bottom = 8.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                listOf(1, 7, 30, 90).chunked(2).forEach { options ->
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        options.forEach { days ->
                                            androidx.compose.material3.FilterChip(
                                                selected = motionRetentionDays == days,
                                                enabled = !savingMotionRetention,
                                                onClick = { motionRetentionDays = days },
                                                label = { Text(if (days == 1) "1 day" else "$days days") },
                                                modifier = Modifier.weight(1f),
                                                colors = androidx.compose.material3.FilterChipDefaults.filterChipColors(
                                                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                                    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                                ),
                                            )
                                        }
                                    }
                                }
                            }
                            Button(
                                enabled = !savingMotionRetention && motionRetentionDays != savedMotionRetentionDays,
                                onClick = {
                                    val days = motionRetentionDays ?: return@Button
                                    savingMotionRetention = true
                                    scope.launch {
                                        val result = withContext(Dispatchers.IO) { runCatching { api.setMotionRetention(currentSession.token, days) } }
                                        result.onSuccess {
                                            motionRetentionDays = it
                                            savedMotionRetentionDays = it
                                            message = "Motion history setting saved."
                                        }.onFailure { message = it.userFacingMessage("Motion history setting could not be saved") }
                                        savingMotionRetention = false
                                    }
                                },
                                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                            ) { Text(if (savingMotionRetention) "Saving…" else "Save changes") }
                        }
                    }
                    BeaconSectionHeader("Account", "Manage your signed-in session and data.")
                    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                        Text("SIGNED IN", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                        Text(currentSession.email ?: "Beacon account", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                    }
                    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                        Text("Delete account", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text(
                            "Permanently remove your Beacon household and its data.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedButton(
                            onClick = {
                                deleteAccountError = ""
                                deleteAccountOpen = true
                            },
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        ) { Text("Delete account") }
                    }
                    OutlinedButton(
                        onClick = {
                            val token = currentSession.token
                            val active = session
                            NotificationConsentStore(context).mute()
                            notificationConsent = false
                            sessionStore.clear()
                            session = null
                            selectedCameraId = null
                            cameras = emptyList()
                            monitorPage = MonitorPage.Home
                            scope.launch(Dispatchers.IO) {
                                runCatching { disableAndroidNotifications(context, api, active) }
                                runCatching { api.logout(token) }
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Sign out") }
                    BeaconSectionHeader("Privacy", "Understand the capture and storage defaults.")
                    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                        BeaconTrustLine("Cloud recording is off unless you turn it on for a camera.")
                        BeaconTrustLine("Camera and microphone use always stays visible on the camera device.")
                    }
                }
            }
        }
            if (message.isNotBlank()) {
                Text(
                    message,
                    color =
                        if (message.contains("could not", true) || message.contains("unavailable", true) || message.contains("expired", true)) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                )
            }
        }
        }
        if (deleteAccountOpen && session != null) {
            AlertDialog(
                onDismissRequest = { if (!deletingAccount) deleteAccountOpen = false },
                title = { Text("Sorry to see you go") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Deleting your account permanently removes:")
                        Text("• Your Beacon household\n• Paired cameras and settings\n• Motion and camera activity history")
                        Text(
                            "Live connections stop immediately.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        if (deleteAccountError.isNotBlank()) {
                            Text(deleteAccountError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                },
                dismissButton = {
                    androidx.compose.material3.TextButton(
                        enabled = !deletingAccount,
                        onClick = { deleteAccountOpen = false },
                    ) { Text("Keep account") }
                },
                confirmButton = {
                    androidx.compose.material3.TextButton(
                        enabled = !deletingAccount,
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        onClick = {
                            val token = session!!.token
                            deletingAccount = true
                            deleteAccountError = ""
                            scope.launch {
                                val result = withContext(Dispatchers.IO) { runCatching { api.deleteAccount(token) } }
                                result.onSuccess {
                                    withContext(Dispatchers.IO) {
                                        runCatching { disableAndroidNotifications(context, api, null) }
                                    }
                                    notificationConsent = false
                                    sessionStore.clear()
                                    session = null
                                    cameras = emptyList()
                                    accessEvents = emptyList()
                                    motionEvents = emptyList()
                                    deleteAccountOpen = false
                                    message = "Your Beacon account and its data were deleted."
                                    onAccountDeleted()
                                }.onFailure {
                                    deleteAccountError = it.userFacingMessage("Your account could not be deleted.")
                                }
                                deletingAccount = false
                            }
                        },
                    ) { Text(if (deletingAccount) "Deleting…" else "Delete account") }
                },
            )
        }
        if (session != null && !isWideLayout) {
            BeaconMonitorNavigation(
                open = navigationOpen,
                selected = monitorPage,
                email = session!!.email ?: "Beacon account",
                themePreference = themePreference,
                onDismiss = { navigationOpen = false },
                onSelect = {
                    monitorPage = it
                    if (it != MonitorPage.Cameras) selectedSettingsDeviceId = null
                },
                onThemePreferenceChange = onThemePreferenceChange,
                onTrustAndPrivacy = {
                    monitorPage = MonitorPage.Settings
                    navigationOpen = false
                },
                onLogout = {
                    val active = session ?: return@BeaconMonitorNavigation
                    NotificationConsentStore(context).mute()
                    notificationConsent = false
                    sessionStore.clear()
                    session = null
                    selectedCameraId = null
                    cameras = emptyList()
                    monitorPage = MonitorPage.Home
                    navigationOpen = false
                    scope.launch(Dispatchers.IO) {
                        runCatching { disableAndroidNotifications(context, api, active) }
                        runCatching { api.logout(active.token) }
                    }
                },
            )
        }
        }
    }
}
