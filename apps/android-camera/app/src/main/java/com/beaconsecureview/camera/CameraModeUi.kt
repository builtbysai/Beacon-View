package com.beaconsecureview.camera

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
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
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.webrtc.SurfaceViewRenderer

@Composable
internal fun PairingScreen(
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
                .safeDrawingPadding()
                .padding(horizontal = 16.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconButton(onClick = onBack, modifier = Modifier.size(44.dp)) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back")
        }
        BeaconPageHeader(
            eyebrow = "Beacon / camera setup",
            title = "Add camera",
            supportingText = "Connect this Android phone or tablet to your household.",
        )
        BeaconPanel(modifier = Modifier.fillMaxWidth()) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                Icon(
                    Icons.Outlined.Smartphone,
                    null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(12.dp).size(24.dp),
                )
            }
            Text(
                "Android phone or tablet",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.ExtraBold,
                modifier = Modifier.padding(top = 14.dp),
            )
            Text(
                "In your signed-in Beacon viewer, open this camera and choose Reconnect. Then scan the new code here.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp, bottom = 14.dp),
            )
            Button(enabled = !busy, onClick = onScan, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.QrCodeScanner, null, modifier = Modifier.size(20.dp))
                Text("Scan and connect", modifier = Modifier.padding(start = 8.dp))
                Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, modifier = Modifier.padding(start = 8.dp).size(18.dp))
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Spacer(Modifier.height(1.dp).weight(1f).background(MaterialTheme.colorScheme.outlineVariant))
                Text("or enter it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(1.dp).weight(1f).background(MaterialTheme.colorScheme.outlineVariant))
            }
            OutlinedTextField(
                value = pairingCode,
                onValueChange = onCodeChange,
                label = { Text("10-character code") },
                supportingText =
                    if (pairingCode.isNotBlank() && !isValidPairingCode(pairingCode)) {
                        { Text("Enter the code shown in Beacon.") }
                    } else {
                        { Text("Letters and numbers only") }
                    },
                isError = pairingCode.isNotBlank() && !isValidPairingCode(pairingCode),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            OutlinedButton(
                enabled = isValidPairingCode(pairingCode) && !busy,
                onClick = onPair,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            ) { Text(if (busy) "Connecting securely…" else "Connect camera") }
        }
        if (message.isNotBlank()) {
            Text(
                message,
                modifier = Modifier.fillMaxWidth(),
                color = if (message.contains("failed", true) || message.contains("cannot", true)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        BeaconTrustLine("Pair only a device you own or are authorized to use. Capture stays visible on this phone.")
    }
}

@Composable
internal fun WelcomeScreen(
    onCameraSetup: () -> Unit,
    onMonitor: () -> Unit,
) {
    Column(
        modifier =
            Modifier.fillMaxSize()
                .verticalScroll(rememberScrollState())
                .safeDrawingPadding()
                .padding(horizontal = 16.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            BeaconWordmark(compact = true)
        }
        BeaconPageHeader(
            eyebrow = "Your space, within reach",
            title = "Welcome to Beacon",
            supportingText = "Use this Android device as a camera or securely view your household.",
        )
        BeaconPanel(modifier = Modifier.fillMaxWidth()) {
            Icon(
                Icons.Outlined.Smartphone,
                null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(28.dp),
            )
            Text("Android phone or tablet", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 12.dp))
            Text("Best for always-on camera use.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, bottom = 14.dp))
            Button(
                onClick = onCameraSetup,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Outlined.Smartphone, null, modifier = Modifier.size(20.dp))
                Text("Set up camera", modifier = Modifier.padding(start = 8.dp))
                Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, modifier = Modifier.padding(start = 8.dp).size(18.dp))
            }
        }
        BeaconPanel(modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Outlined.Videocam, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
            Text("Monitor your cameras", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 12.dp))
            Text("Sign in to view cameras already on your account.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, bottom = 14.dp))
            OutlinedButton(onClick = onMonitor, modifier = Modifier.fillMaxWidth()) { Text("Open Monitor") }
        }
        BeaconTrustLine("Cloud recording is optional and off by default.")
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
    val trustedHttps =
        link.scheme.equals("https", ignoreCase = true) &&
            trustedHost != null &&
            link.host.equals(trustedHost, ignoreCase = true) &&
            link.path == "/auth/mobile"
    val trustedAppReturn =
        link.scheme.equals("beaconsecureview", ignoreCase = true) &&
            link.host.equals("auth", ignoreCase = true) &&
            link.path == "/mobile"
    if (!trustedHttps && !trustedAppReturn) return null
    val code =
        (link.rawQuery ?: link.rawFragment)
            ?.split('&')
            ?.firstOrNull { it.substringBefore('=').equals("code", ignoreCase = true) }
            ?.substringAfter('=', missingDelimiterValue = "")
    return code?.takeIf { it.length in 32..512 && it.matches(Regex("[A-Za-z0-9_-]+")) }
}

@Composable
internal fun PairingSuccess() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        BeaconStatusPill("CONNECTED", BeaconOnline)
        Text(
            "Camera connected",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(top = 16.dp),
        )
        Text("Starting Camera Mode…", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

internal enum class CameraPermissionPrompt(
    val title: String,
    val description: String,
    val action: String,
) {
    Camera(
        title = "Camera access needed",
        description = "Allow camera access to show the local preview and share live video.",
        action = "Allow camera",
    ),
    Notification(
        title = "Status notification needed",
        description = "Allow Beacon's ongoing status notification before Camera mode starts.",
        action = "Allow status notification",
    ),
    Microphone(
        title = "Microphone is off",
        description = "Video remains available. Allow microphone access for Listen and recordings with sound.",
        action = "Allow microphone",
    ),
}

internal fun cameraPermissionPrompt(
    cameraAllowed: Boolean,
    notificationsAllowed: Boolean,
    microphoneAllowed: Boolean,
): CameraPermissionPrompt? =
    when {
        !cameraAllowed -> CameraPermissionPrompt.Camera
        !notificationsAllowed -> CameraPermissionPrompt.Notification
        !microphoneAllowed -> CameraPermissionPrompt.Microphone
        else -> null
    }

@Composable
internal fun CameraHome(
    runtime: CameraRuntimeState,
    cameraPermission: Boolean,
    notificationPermission: Boolean,
    microphonePermission: Boolean,
    onAllowCamera: () -> Unit,
    onAllowNotifications: () -> Unit,
    onAllowMicrophone: () -> Unit,
    onPrivacy: () -> Unit,
    onSelectCamera: (String) -> Unit,
    onDisconnect: () -> Unit,
    disconnecting: Boolean,
    onOpenBackgroundSettings: () -> Unit,
    onMonitor: () -> Unit,
    monitorSignedIn: Boolean,
) {
    var settingsOpen by remember { mutableStateOf(false) }
    var disconnectConfirmationOpen by remember { mutableStateOf(false) }
    val permissionPrompt =
        cameraPermissionPrompt(
            cameraAllowed = cameraPermission,
            notificationsAllowed = notificationPermission,
            microphoneAllowed = microphonePermission,
        )
    val selectedSource = runtime.cameras.find { it.id == runtime.selectedCameraId }
    val selectedIndex = runtime.cameras.indexOfFirst { it.id == runtime.selectedCameraId }
    val switchTarget =
        if (runtime.cameras.size < 2) null
        else runtime.cameras[(selectedIndex.takeIf { it >= 0 }?.plus(1) ?: 0) % runtime.cameras.size]

    Box(modifier = Modifier.fillMaxSize().background(BeaconCanvas)) {
        if (shouldShowLocalPreview(runtime.privacyMode, CameraRuntime.previewView != null)) {
            AndroidView(
                factory = {
                    (CameraRuntime.previewView
                            ?: PreviewView(it).apply {
                                implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                            })
                        .also { preview ->
                            preview.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                            (preview.parent as? ViewGroup)?.removeView(preview)
                        }
                },
                modifier =
                    Modifier.fillMaxSize().semantics {
                        contentDescription = "Live camera preview"
                    },
            )
        } else {
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    if (runtime.privacyMode) Icons.Outlined.Lock else Icons.Outlined.Videocam,
                    null,
                    tint = Color(0xFF7FA3C9),
                    modifier = Modifier.size(38.dp),
                )
                Text(
                    when {
                        runtime.privacyMode -> "Paused"
                        permissionPrompt == CameraPermissionPrompt.Camera -> "Camera permission needed"
                        permissionPrompt == CameraPermissionPrompt.Notification -> "Status notification needed"
                        else -> "Starting camera…"
                    },
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        Row(
            modifier =
                Modifier.align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color(0xCC020812), Color.Transparent)))
                    .safeDrawingPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            CameraRuntimeStatus(runtime)
            Spacer(Modifier.weight(1f))
            if (runtime.activeViewers > 0) {
                Surface(shape = RoundedCornerShape(999.dp), color = Color(0x99030B17)) {
                    Row(
                        modifier = Modifier.padding(horizontal = 11.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        Icon(Icons.Outlined.Visibility, "Viewers", tint = Color.White, modifier = Modifier.size(17.dp))
                        Text(runtime.activeViewers.toString(), color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Box {
                IconButton(onClick = { settingsOpen = true }) {
                    Icon(Icons.Outlined.Settings, "Camera options", tint = Color.White)
                }
                DropdownMenu(
                    expanded = settingsOpen,
                    onDismissRequest = { settingsOpen = false },
                    containerColor = Color(0xFFF8FAFC),
                ) {
                    DropdownMenuItem(
                        text = { Text(if (monitorSignedIn) "Monitor" else "Sign in") },
                        leadingIcon = { Icon(Icons.Outlined.Person, null) },
                        onClick = {
                            settingsOpen = false
                            onMonitor()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Disconnect camera", color = Color(0xFFB42318)) },
                        leadingIcon = { Icon(Icons.Outlined.LinkOff, null, tint = Color(0xFFB42318)) },
                        onClick = {
                            settingsOpen = false
                            disconnectConfirmationOpen = true
                        },
                    )
                }
            }
        }

        Column(
            modifier =
                Modifier.align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6020812))))
                    .safeDrawingPadding()
                    .padding(horizontal = 18.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (permissionPrompt != null) {
                Surface(shape = RoundedCornerShape(16.dp), color = Color(0xEFFFFFFF)) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            permissionPrompt.title,
                            color = Color(0xFF0F172A),
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            permissionPrompt.description,
                            color = Color(0xFF64748B),
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Button(
                            onClick =
                                when (permissionPrompt) {
                                    CameraPermissionPrompt.Camera -> onAllowCamera
                                    CameraPermissionPrompt.Notification -> onAllowNotifications
                                    CameraPermissionPrompt.Microphone -> onAllowMicrophone
                                },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(permissionPrompt.action)
                        }
                    }
                }
            }
            if (runtime.batteryOptimizationRestricted) {
                Surface(shape = RoundedCornerShape(16.dp), color = Color(0xF2FFF4D6)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "Keep camera running",
                                color = Color(0xFF5F4300),
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                "Allow unrestricted battery use for reliable unattended viewing.",
                                color = Color(0xFF735600),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        OutlinedButton(onClick = onOpenBackgroundSettings) {
                            Text("Allow")
                        }
                    }
                }
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (switchTarget != null && !runtime.privacyMode) {
                    Surface(shape = RoundedCornerShape(999.dp), color = Color(0xCC071522)) {
                        IconButton(
                            enabled =
                                canSwitchCameraSource(
                                    runtime.selectedCameraId,
                                    switchTarget.id,
                                    runtime.sourceLifecycle,
                                    runtime.privacyMode,
                                ),
                            onClick = { onSelectCamera(switchTarget.id) },
                            modifier = Modifier.semantics { contentDescription = "Switch to ${switchTarget.name}" },
                        ) {
                            Icon(Icons.Outlined.Cameraswitch, null, tint = Color.White)
                        }
                    }
                }
                Button(
                    onClick = onPrivacy,
                    enabled = !runtime.privacyChangePending,
                    colors =
                        if (runtime.privacyMode) ButtonDefaults.buttonColors(containerColor = BeaconActionBright, contentColor = Color(0xFF04101C))
                        else ButtonDefaults.buttonColors(containerColor = Color(0xE6FFFFFF), contentColor = Color(0xFF071522)),
                ) {
                    Icon(if (runtime.privacyMode) Icons.Outlined.Videocam else Icons.Outlined.Lock, null, modifier = Modifier.size(19.dp))
                    Text(
                        when {
                            runtime.privacyChangePending -> "Updating…"
                            runtime.privacyMode -> "Resume"
                            else -> "Pause"
                        },
                        modifier = Modifier.padding(start = 7.dp),
                    )
                }
            }
            if (selectedSource != null) {
                Text(selectedSource.name, color = Color(0xFFCAD6E6), style = MaterialTheme.typography.bodySmall)
            }
            if (runtime.privacySyncPending) {
                Text("Paused locally · syncing when online", color = Color(0xFFFFD28A), style = MaterialTheme.typography.bodySmall)
            }
        }
        if (disconnectConfirmationOpen) {
            AlertDialog(
                onDismissRequest = { if (!disconnecting) disconnectConfirmationOpen = false },
                title = { Text("Disconnect this camera?") },
                text = {
                    Text(
                        "Capture will stop immediately and this phone will need a new pairing code before it can be used as a camera again.",
                    )
                },
                confirmButton = {
                    Button(
                        onClick = {
                            disconnectConfirmationOpen = false
                            onDisconnect()
                        },
                        enabled = !disconnecting,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB42318)),
                    ) {
                        Text("Disconnect")
                    }
                },
                dismissButton = {
                    OutlinedButton(
                        onClick = { disconnectConfirmationOpen = false },
                        enabled = !disconnecting,
                    ) {
                        Text("Keep connected")
                    }
                },
            )
        }
    }
}

@Composable
private fun CameraRuntimeStatus(runtime: CameraRuntimeState) {
    val compactOnline =
        !runtime.privacyMode &&
            runtime.activeViewers == 0 &&
            (runtime.device == DeviceLifecycle.Idle || runtime.device == DeviceLifecycle.Online)
    if (!compactOnline) {
        BeaconStatusPill(cameraRuntimeLabel(runtime), cameraRuntimeColor(runtime))
        return
    }
    var expanded by remember { mutableStateOf(false) }
    Surface(
        modifier =
            Modifier.onFocusChanged {
                    if (!it.isFocused) expanded = false
                }
                .semantics {
                    contentDescription =
                        if (expanded) "Online. Collapse status" else "Online. Expand status"
                }
                .clickable(role = Role.Button) { expanded = !expanded },
        shape = RoundedCornerShape(999.dp),
        color = Color(0x99030B17),
    ) {
        Row(
            modifier =
                Modifier.padding(
                    horizontal = if (expanded) 10.dp else 5.dp,
                    vertical = 5.dp,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                Modifier.size(9.dp)
                    .background(BeaconOnline, RoundedCornerShape(999.dp)),
            )
            if (expanded) {
                Text("Online", color = Color.White, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

internal fun cameraRuntimeLabel(runtime: CameraRuntimeState): String =
    when {
        runtime.privacyMode -> "PRIVACY ON"
        runtime.activeViewers > 0 -> "LIVE"
        runtime.device == DeviceLifecycle.Idle || runtime.device == DeviceLifecycle.Online -> "ONLINE"
        runtime.device == DeviceLifecycle.Reconnecting -> "RECONNECTING"
        else -> runtime.device.name.uppercase()
    }

@Composable
private fun cameraRuntimeColor(runtime: CameraRuntimeState): Color =
    when {
        runtime.privacyMode -> BeaconPrivacy
        runtime.activeViewers > 0 -> BeaconLive
        runtime.device == DeviceLifecycle.Idle || runtime.device == DeviceLifecycle.Online -> BeaconOnline
        runtime.device == DeviceLifecycle.Reconnecting -> BeaconWarning
        else -> BeaconOffline
    }
