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
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material.icons.outlined.Add
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
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.Warning
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
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
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
import kotlin.math.roundToInt
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
    onCameraMode: () -> Unit,
    onSetUpThisDevice: (String) -> Unit,
    onAccountDeleted: () -> Unit,
    inboundGoogleAuthCode: MobileGoogleAuthResult?,
    onInboundGoogleAuthCodeHandled: () -> Unit,
    onGoogleSignIn: () -> Unit,
    themePreference: BeaconThemePreference,
    onThemePreferenceChange: (BeaconThemePreference) -> Unit,
    launchTarget: LaunchTarget? = null,
    onLaunchTargetHandled: () -> Unit = {},
) {
    val context = LocalContext.current
    val sessionState = remember { mutableStateOf(sessionStore.read()) }
    var session by sessionState
    val emailState = remember { mutableStateOf("") }
    var email by emailState
    val passwordState = remember { mutableStateOf("") }
    var password by passwordState
    val showPasswordState = rememberSaveable { mutableStateOf(false) }
    var showPassword by showPasswordState
    val googleSignInAvailableState = remember { mutableStateOf(true) }
    var googleSignInAvailable by googleSignInAvailableState
    val camerasState = remember { mutableStateOf<List<BeaconApi.MonitorCamera>>(emptyList()) }
    var cameras by camerasState
    val devicesState = remember { mutableStateOf<List<BeaconApi.Device>>(emptyList()) }
    var devices by devicesState
    val selectedCameraIdState = rememberSaveable { mutableStateOf<String?>(null) }
    var selectedCameraId by selectedCameraIdState
    val selectedSettingsDeviceIdState = rememberSaveable { mutableStateOf<String?>(null) }
    var selectedSettingsDeviceId by selectedSettingsDeviceIdState
    val addCameraChoiceOpenState = rememberSaveable(session?.userId) { mutableStateOf(false) }
    var addCameraChoiceOpen by addCameraChoiceOpenState
    val pairAnotherDeviceOpenState = rememberSaveable(session?.userId) { mutableStateOf(false) }
    var pairAnotherDeviceOpen by pairAnotherDeviceOpenState
    val favoritesStore = remember(context) { CameraFavoritesStore(context.applicationContext) }
    val orderStore = remember(context) { CameraOrderStore(context.applicationContext) }
    val favoriteCameraIdsState = remember(session?.userId) {
        mutableStateOf(session?.let { favoritesStore.read(it.userId) } ?: emptySet())
    }
    var favoriteCameraIds by favoriteCameraIdsState
    val hasSavedFavoritesState = remember(session?.userId) {
        mutableStateOf(session?.let { favoritesStore.hasSaved(it.userId) } ?: false)
    }
    var hasSavedFavorites by hasSavedFavoritesState
    val favoritesEditorOpenState = rememberSaveable(session?.userId) { mutableStateOf(false) }
    var favoritesEditorOpen by favoritesEditorOpenState
    val cameraOrderIdsState = remember(session?.userId) {
        mutableStateOf(session?.let { orderStore.read(it.userId) } ?: emptyList())
    }
    var cameraOrderIds by cameraOrderIdsState
    val cameraCatalogQueryState = rememberSaveable(session?.userId) { mutableStateOf("") }
    var cameraCatalogQuery by cameraCatalogQueryState
    val cameraCatalogFilterState = rememberSaveable(session?.userId) { mutableStateOf(CameraCatalogFilter.All) }
    var cameraCatalogFilter by cameraCatalogFilterState
    val monitorPageState = rememberSaveable(session?.userId) { mutableStateOf(MonitorPage.Home) }
    var monitorPage by monitorPageState
    val eventsViewState = rememberSaveable(session?.userId) { mutableStateOf(MonitorEventsView.Activity) }
    var eventsView by eventsViewState
    val navigationOpenState = rememberSaveable(session?.userId) { mutableStateOf(false) }
    var navigationOpen by navigationOpenState
    val householdState = remember(session?.userId) { mutableStateOf<BeaconApi.HouseholdSummary?>(null) }
    var household by householdState
    val accessEventsState = remember(session?.userId) {
        mutableStateOf<List<BeaconApi.AccessEvent>>(emptyList())
    }
    var accessEvents by accessEventsState
    val accessHistoryLoadedState = remember(session?.userId) { mutableStateOf(false) }
    var accessHistoryLoaded by accessHistoryLoadedState
    val accessHistoryPageState = rememberSaveable(session?.userId) { mutableStateOf(0) }
    var accessHistoryPage by accessHistoryPageState
    val motionRetentionDaysState = remember(session?.userId) { mutableStateOf<Int?>(null) }
    var motionRetentionDays by motionRetentionDaysState
    val savedMotionRetentionDaysState = remember(session?.userId) { mutableStateOf<Int?>(null) }
    var savedMotionRetentionDays by savedMotionRetentionDaysState
    val savingMotionRetentionState = remember { mutableStateOf(false) }
    var savingMotionRetention by savingMotionRetentionState
    val deviceControlBusyState = remember { mutableStateOf(false) }
    var deviceControlBusy by deviceControlBusyState
    val deleteAccountOpenState = rememberSaveable { mutableStateOf(false) }
    var deleteAccountOpen by deleteAccountOpenState
    val deletingAccountState = remember { mutableStateOf(false) }
    var deletingAccount by deletingAccountState
    val deleteAccountErrorState = remember { mutableStateOf("") }
    var deleteAccountError by deleteAccountErrorState
    val motionEventsState = remember(session?.userId) {
        mutableStateOf<List<BeaconApi.MotionEvent>>(emptyList())
    }
    var motionEvents by motionEventsState
    val motionEventsLoadedState = remember(session?.userId) { mutableStateOf(false) }
    var motionEventsLoaded by motionEventsLoadedState
    val cameraMotionSettingsState = remember(selectedSettingsDeviceId) {
        mutableStateOf<List<BeaconApi.CameraMotionSettings>>(emptyList())
    }
    var cameraMotionSettings by cameraMotionSettingsState
    val cameraMotionSettingsLoadedState = remember(selectedSettingsDeviceId) { mutableStateOf(false) }
    var cameraMotionSettingsLoaded by cameraMotionSettingsLoadedState
    val cameraMotionSettingsBusyState = remember { mutableStateOf(false) }
    var cameraMotionSettingsBusy by cameraMotionSettingsBusyState
    val cameraMotionSettingsErrorState = remember(selectedSettingsDeviceId) { mutableStateOf("") }
    var cameraMotionSettingsError by cameraMotionSettingsErrorState
    val cameraMotionSettingsNoticeState = remember(selectedSettingsDeviceId) { mutableStateOf("") }
    var cameraMotionSettingsNotice by cameraMotionSettingsNoticeState
    val recordingsState = remember(session?.userId) {
        mutableStateOf<List<BeaconApi.RecordingSummary>>(emptyList())
    }
    var recordings by recordingsState
    val recordingsLoadedState = remember(session?.userId) { mutableStateOf(false) }
    var recordingsLoaded by recordingsLoadedState
    val recordingsCursorState = remember(session?.userId) { mutableStateOf<String?>(null) }
    var recordingsCursor by recordingsCursorState
    val recordingBusyIdState = remember { mutableStateOf<String?>(null) }
    var recordingBusyId by recordingBusyIdState
    val recordingsLoadingMoreState = remember { mutableStateOf(false) }
    var recordingsLoadingMore by recordingsLoadingMoreState
    val recordingPlaybackState = remember { mutableStateOf<BeaconApi.PlaybackRecording?>(null) }
    var recordingPlayback by recordingPlaybackState
    val recordingDeleteTargetState = remember { mutableStateOf<BeaconApi.RecordingSummary?>(null) }
    var recordingDeleteTarget by recordingDeleteTargetState
    val recordingShareTargetState = remember { mutableStateOf<BeaconApi.RecordingSummary?>(null) }
    var recordingShareTarget by recordingShareTargetState
    val messageState = remember { mutableStateOf("") }
    var message by messageState
    val busyState = remember { mutableStateOf(false) }
    var busy by busyState
    val scope = rememberCoroutineScope()
    LaunchedEffect(session) {
        if (session == null) {
            withContext(Dispatchers.IO) { runCatching { api.googleSignInAvailable() } }
                .onSuccess { googleSignInAvailable = it }
        }
    }
    val notificationConsentState = remember { mutableStateOf(NotificationConsentStore(context).enabled) }
    var notificationConsent by notificationConsentState
    val notificationBusyState = remember { mutableStateOf(false) }
    var notificationBusy by notificationBusyState
    val notificationPreferencesState = remember(session?.userId) {
        mutableStateOf<List<BeaconApi.NotificationPreference>>(emptyList())
    }
    var notificationPreferences by notificationPreferencesState
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
    val settingsSectionOffsets = remember { mutableStateMapOf<String, Int>() }
    val settingsSections = listOf("Household", "Notifications", "People & access", "Data & storage", "Security", "Account", "Privacy")
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
        val inbound = inboundGoogleAuthCode ?: return@LaunchedEffect
        when {
            inbound.code != null && session == null -> {
                busy = true
                // The verifier was kept when sign-in started; without it (for example a link from another
                // app) the code cannot be redeemed and the attempt simply fails.
                val verifier = GoogleSignInPkce(context).take()
                val result =
                    withContext(Dispatchers.IO) {
                        runCatching {
                            api.exchangeGoogleSignIn(inbound.code, verifier ?: error("No sign-in in progress"))
                        }
                    }
                result.onSuccess {
                    sessionStore.save(it)
                    session = it
                    message = ""
                }.onFailure {
                    message = it.userFacingMessage("Google sign-in could not be completed.")
                }
                busy = false
            }
            // Mirrors AuthScreen.tsx's `googleResult === 'linkRequired'`/`'failed'`
            // alerts -- the backend redirects here with a status instead of a
            // handoff code when it has no session to hand back.
            inbound.status == "linkRequired" -> {
                message =
                    "Google sign-in succeeded, but you need to sign in with your password first to link the account. Once you do, we'll link your Google account automatically."
            }
            inbound.status == "failed" -> {
                message = "Google sign-in could not be completed. Please try again."
            }
        }
        // Clearing this state before an awaited exchange above would cancel this
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
                    message = "Cameras are temporarily unavailable. ${it.userFacingMessage("Try again.")}"
                }
            }
            withContext(Dispatchers.IO) { runCatching { api.devices(token) } }
                .onSuccess { refreshedDevices ->
                    devices = refreshedDevices
                    cameras = cameras.map { camera ->
                        val device = refreshedDevices.find { it.id == camera.deviceId }
                        camera.copy(needsPairing = device?.platform == "android" && (device.revoked || !device.online))
                    }
                }
                .onFailure { if (it is AuthorizationLostException) expireSession() }
            if (showLoading) busy = false
        }
    }

    LaunchedEffect(session, selectedCameraId) {
        val active = session ?: return@LaunchedEffect
        while (session == active) {
            refresh(active.token)
            // Each refresh is two requests. Five seconds keeps viewer counts and camera status fresh
            // enough while a camera is open without a request per second (V66).
            delay(if (selectedCameraId == null) 15_000 else 5_000)
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
                    motionEvents = it.events
                    motionEventsLoaded = true
                }.onFailure {
                    message = it.userFacingMessage("Activity is temporarily unavailable")
                    motionEventsLoaded = true
                }
            }
            MonitorPage.Events -> if (eventsView != MonitorEventsView.Activity) {
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
                withContext(Dispatchers.IO) { runCatching { api.currentHousehold(active.token) } }
                    .onSuccess { household = it }
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

    // Alerts and launcher shortcuts (ADR 0095): open the camera or page they name once the person
    // is signed in and the cameras are known. A target nobody got to goes stale.
    LaunchedEffect(launchTarget, session?.token, cameras) {
        val target = launchTarget ?: return@LaunchedEffect
        if (!LaunchIntents.isFresh(target, System.currentTimeMillis())) {
            onLaunchTargetHandled()
            return@LaunchedEffect
        }
        val active = session ?: return@LaunchedEffect
        if (target !is LaunchTarget.OpenPage && cameras.isEmpty()) return@LaunchedEffect
        val alertCameraId =
            if (target is LaunchTarget.OpenAlert) {
                val resolved =
                    withContext(Dispatchers.IO) {
                        runCatching { api.notificationEventCamera(active.token, target.eventId) }
                    }
                if (resolved.exceptionOrNull() is AuthorizationLostException) {
                    onLaunchTargetHandled()
                    return@LaunchedEffect
                }
                resolved.getOrNull()
            } else {
                null
            }
        when (val resolution = resolveLaunch(target, monitorHostCameras(cameras).map { it.id }, alertCameraId)) {
            is LaunchResolution.Watch -> {
                selectedSettingsDeviceId = null
                selectedCameraId = resolution.cameraId
            }
            is LaunchResolution.Show -> {
                selectedCameraId = null
                selectedSettingsDeviceId = null
                monitorPage = resolution.page
            }
        }
        onLaunchTargetHandled()
    }

    // Favorite cameras become launcher shortcuts; signing out removes them from the home screen.
    LaunchedEffect(session?.userId, cameras, favoriteCameraIds, hasSavedFavorites) {
        if (session == null) {
            LauncherShortcuts.clear(context)
        } else if (cameras.isNotEmpty()) {
            LauncherShortcuts.publish(
                context,
                homeFavoriteCameras(monitorHostCameras(cameras), favoriteCameraIds, hasSavedFavorites),
            )
        }
    }

    val state =
        MonitorHomeState(
            context = context,
            scope = scope,
            api = api,
            sessionStore = sessionStore,
            favoritesStore = favoritesStore,
            orderStore = orderStore,
            monitorScrollState = monitorScrollState,
            settingsSectionOffsets = settingsSectionOffsets,
            settingsSections = settingsSections,
            navigationPreferences = navigationPreferences,
            alertPermissionLauncher = alertPermissionLauncher,
            onCameraMode = onCameraMode,
            onSetUpThisDevice = onSetUpThisDevice,
            onAccountDeleted = onAccountDeleted,
            themePreference = themePreference,
            onThemePreferenceChange = onThemePreferenceChange,
            expireSession = ::expireSession,
            enableNotifications = ::enableNotifications,
            refreshCameras = ::refresh,
            sessionState = sessionState,
            emailState = emailState,
            passwordState = passwordState,
            showPasswordState = showPasswordState,
            googleSignInAvailableState = googleSignInAvailableState,
            camerasState = camerasState,
            devicesState = devicesState,
            selectedCameraIdState = selectedCameraIdState,
            selectedSettingsDeviceIdState = selectedSettingsDeviceIdState,
            addCameraChoiceOpenState = addCameraChoiceOpenState,
            pairAnotherDeviceOpenState = pairAnotherDeviceOpenState,
            favoriteCameraIdsState = favoriteCameraIdsState,
            hasSavedFavoritesState = hasSavedFavoritesState,
            favoritesEditorOpenState = favoritesEditorOpenState,
            cameraOrderIdsState = cameraOrderIdsState,
            cameraCatalogQueryState = cameraCatalogQueryState,
            cameraCatalogFilterState = cameraCatalogFilterState,
            monitorPageState = monitorPageState,
            eventsViewState = eventsViewState,
            navigationOpenState = navigationOpenState,
            householdState = householdState,
            accessEventsState = accessEventsState,
            accessHistoryLoadedState = accessHistoryLoadedState,
            accessHistoryPageState = accessHistoryPageState,
            motionRetentionDaysState = motionRetentionDaysState,
            savedMotionRetentionDaysState = savedMotionRetentionDaysState,
            savingMotionRetentionState = savingMotionRetentionState,
            deviceControlBusyState = deviceControlBusyState,
            deleteAccountOpenState = deleteAccountOpenState,
            deletingAccountState = deletingAccountState,
            deleteAccountErrorState = deleteAccountErrorState,
            motionEventsState = motionEventsState,
            motionEventsLoadedState = motionEventsLoadedState,
            cameraMotionSettingsState = cameraMotionSettingsState,
            cameraMotionSettingsLoadedState = cameraMotionSettingsLoadedState,
            cameraMotionSettingsBusyState = cameraMotionSettingsBusyState,
            cameraMotionSettingsErrorState = cameraMotionSettingsErrorState,
            cameraMotionSettingsNoticeState = cameraMotionSettingsNoticeState,
            recordingsState = recordingsState,
            recordingsLoadedState = recordingsLoadedState,
            recordingsCursorState = recordingsCursorState,
            recordingBusyIdState = recordingBusyIdState,
            recordingsLoadingMoreState = recordingsLoadingMoreState,
            recordingPlaybackState = recordingPlaybackState,
            recordingDeleteTargetState = recordingDeleteTargetState,
            recordingShareTargetState = recordingShareTargetState,
            messageState = messageState,
            busyState = busyState,
            notificationConsentState = notificationConsentState,
            notificationBusyState = notificationBusyState,
            notificationPreferencesState = notificationPreferencesState,
        )
    val activeSession = session
    val orderByCameraId = cameraOrderIds.withIndex().associate { it.value to it.index }
    val orderedCameras =
        monitorHostCameras(cameras).sortedBy { orderByCameraId[it.id] ?: Int.MAX_VALUE }
    val activeCamera = orderedCameras.find { it.id == selectedCameraId }
    if (activeSession != null && activeCamera != null) {
        val alternateSource = nextCameraSource(cameras, activeCamera)
        AndroidLiveView(
            camera = activeCamera,
            sessionToken = activeSession.token,
            onBack = { selectedCameraId = null },
            onDevice = {
                selectedCameraId = null
                monitorPage = MonitorPage.Cameras
                selectedSettingsDeviceId = activeCamera.deviceId
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
        )
        return
    }

    BackHandler(enabled = selectedSettingsDeviceId != null) {
        selectedSettingsDeviceId = null
    }
    BackHandler(enabled = navigationOpen) { navigationOpen = false }
    BackHandler(enabled = addCameraChoiceOpen) { addCameraChoiceOpen = false }

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
                BeaconMonitorTopBar(
                    onOpenNavigation = { navigationOpen = true },
                    onAddCamera = if (!addCameraChoiceOpen && monitorPage in setOf(MonitorPage.Home, MonitorPage.Cameras) && session?.householdRole in setOf("owner", "admin")) {{ addCameraChoiceOpen = true }} else null,
                )
            }
            if (session != null && monitorPage == MonitorPage.Settings && !addCameraChoiceOpen) {
                Row(
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    settingsSections.filter { it !in setOf("Notifications", "Security") || session?.householdRole in setOf("owner", "admin") }
                        .forEach { section ->
                            val active = settingsSectionOffsets.entries
                                .filter { monitorScrollState.value >= it.value - 32 }
                                .maxByOrNull { it.value }?.key ?: "Household"
                            androidx.compose.material3.TextButton(
                                onClick = { scope.launch { monitorScrollState.animateScrollTo(settingsSectionOffsets[section] ?: 0) } },
                                shape = RoundedCornerShape(50),
                                colors = ButtonDefaults.textButtonColors(
                                    containerColor = if (active == section) MaterialTheme.colorScheme.surface else Color.Transparent,
                                    contentColor = if (active == section) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                ),
                            ) { Text(section, fontWeight = if (active == section) FontWeight.Bold else FontWeight.Medium) }
                        }
                }
            }
            Column(
                modifier =
                    Modifier.fillMaxWidth()
                        .weight(1f)
                        .verticalScroll(monitorScrollState)
                        .then(if (session == null) Modifier.safeDrawingPadding() else Modifier.navigationBarsPadding())
                        .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
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
                            password = ""
                            if (it == null) {
                                // Email is set up: the new account signs in only after its link is opened (V26).
                                message = "We sent a link to ${email.trim()}. Open it to finish creating your account, then sign in."
                            } else {
                                sessionStore.save(it)
                                session = it
                                message = ""
                            }
                        }.onFailure { message = it.userFacingMessage("Account could not be created") }
                        busy = false
                    }
                },
                onGoogleSignIn = onGoogleSignIn,
                googleSignInAvailable = googleSignInAvailable,
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
            if (addCameraChoiceOpen) {
                BeaconAddCameraChoicePage(
                    onDismiss = { addCameraChoiceOpen = false },
                    onPairAnotherDevice = {
                        pairAnotherDeviceOpen = true
                    },
                    onUseThisDevice = {
                        addCameraChoiceOpen = false
                        onSetUpThisDevice(currentSession.token)
                    },
                )
            } else {
                AppUpdateBanner()
                DriveExpiredBanner(api, currentSession.token, currentSession.householdRole == "owner")
                when (monitorPage) {
                MonitorPage.Home -> MonitorHomePage(state, currentSession)
                MonitorPage.Cameras -> MonitorCamerasPage(state, currentSession)
                MonitorPage.Events -> MonitorEventsPage(state, currentSession)
                MonitorPage.Settings -> MonitorSettingsPage(state, currentSession)
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
        if (pairAnotherDeviceOpen && session != null) {
            BeaconPairAnotherDeviceDialog(
                api = api,
                sessionToken = session!!.token,
                onDismiss = { pairAnotherDeviceOpen = false },
            )
        }
        if (deleteAccountOpen && session != null) {
            // The server wants a sign-in within the last ten minutes; when it says so, ask for the password (V73).
            var deletePassword by remember { mutableStateOf("") }
            var passwordRequired by remember { mutableStateOf(false) }
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
                        if (passwordRequired) {
                            androidx.compose.material3.OutlinedTextField(
                                value = deletePassword,
                                onValueChange = { deletePassword = it },
                                label = { Text("Password") },
                                singleLine = true,
                                visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                                keyboardOptions =
                                    androidx.compose.foundation.text.KeyboardOptions(
                                        keyboardType = androidx.compose.ui.text.input.KeyboardType.Password,
                                    ),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
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
                                val result =
                                    withContext(Dispatchers.IO) {
                                        runCatching {
                                            if (passwordRequired && deletePassword.isNotEmpty()) api.reauthenticate(token, deletePassword)
                                            api.deleteAccount(token)
                                        }
                                    }
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
                                    if (it.message?.startsWith("Sign in again") == true) {
                                        passwordRequired = true
                                        deleteAccountError = "For your security, enter your password to confirm."
                                    } else {
                                        deleteAccountError = it.userFacingMessage("Your account could not be deleted.")
                                    }
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
                    addCameraChoiceOpen = false
                    monitorPage = it
                    if (it != MonitorPage.Cameras) selectedSettingsDeviceId = null
                },
                onThemePreferenceChange = onThemePreferenceChange,
                onTrustAndPrivacy = {
                    navigationOpen = false
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${BuildConfig.BEACON_WEB_URL.trimEnd('/')}/trust")))
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
