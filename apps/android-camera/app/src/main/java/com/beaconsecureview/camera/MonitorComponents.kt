package com.beaconsecureview.camera

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Cameraswitch
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Mirrors the PWA's CameraSettings.tsx structurally: a device health
 * summary, an attention/guidance notice when something needs it, the
 * camera-source list, a privacy toggle, device information, and a danger
 * section -- rather than the invented "device status card" the previous
 * version of this screen showed. Owns its own rename/remove/reconnect
 * network calls (matching this session's other Settings-adjacent panels)
 * so [onChanged] is the only thing the caller needs to react to. */
@Composable
internal fun MonitorDeviceSettings(
    api: BeaconApi,
    sessionToken: String,
    device: BeaconApi.Device?,
    sources: List<BeaconApi.MonitorCamera>,
    canManageSettings: Boolean,
    busy: Boolean,
    onBack: () -> Unit,
    onView: (BeaconApi.MonitorCamera) -> Unit,
    onActivate: (BeaconApi.MonitorCamera) -> Unit,
    onPrivacyChange: (Boolean) -> Unit,
    onAuthorizationLost: () -> Unit,
    onChanged: () -> Unit,
    motionContent: @Composable () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val activeSource = sources.firstOrNull { it.available } ?: sources.first()
    val online = sources.any { it.online }
    val privacyMode = sources.any { it.privacyMode }
    val viewers = sources.sumOf { it.viewerCount }

    var renamingDevice by remember(device?.id) { mutableStateOf(false) }
    var renameDeviceText by remember(device?.id) { mutableStateOf(device?.name.orEmpty()) }
    var renameBusy by remember { mutableStateOf(false) }
    var renamingCameraId by remember { mutableStateOf<String?>(null) }
    var renameCameraText by remember { mutableStateOf("") }
    var actionError by remember { mutableStateOf("") }
    var reconnectOpen by remember { mutableStateOf(false) }
    var reconnectCode by remember { mutableStateOf<String?>(null) }
    var reconnectBusy by remember { mutableStateOf(false) }
    var reconnectCopied by remember { mutableStateOf(false) }
    var removeConfirmOpen by remember { mutableStateOf(false) }
    var removeBusy by remember { mutableStateOf(false) }
    var deleteCameraTarget by remember { mutableStateOf<BeaconApi.MonitorCamera?>(null) }
    var deleteCameraBusy by remember { mutableStateOf(false) }
    var detailsExpanded by remember { mutableStateOf(false) }

    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to cameras")
        }
        BeaconWordmark(compact = true)
    }

    if (device == null) {
        Text("Loading device…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }

    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
        Column {
            Text(
                deviceKindLabel(device.platform, device.deviceType).uppercase(),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(device.name, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
        }
        if (canManageSettings) {
            IconButton(onClick = { renameDeviceText = device.name; renamingDevice = true }) {
                Icon(Icons.Outlined.Edit, "Rename this camera")
            }
        }
    }
    if (actionError.isNotBlank()) Text(actionError, color = MaterialTheme.colorScheme.error)

    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("Connection", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                Text(
                    deviceConnectionLabel(device),
                    fontWeight = FontWeight.Bold,
                    color = if (deviceIsHealthy(device)) BeaconOnline else MaterialTheme.colorScheme.onSurface,
                )
            }
            Column {
                Text("Last seen", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                Text(relativeLastSeen(device.lastSeenAt), fontWeight = FontWeight.Bold)
            }
            Column {
                Text("Viewers", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                Text(viewers.toString(), fontWeight = FontWeight.Bold)
            }
        }
    }

    val notice = deviceAttentionNotice(device, sources.size, canReconnect = canManageSettings)
    if (notice != null) {
        BeaconPanel(modifier = Modifier.fillMaxWidth()) {
            Text(notice.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(notice.summary, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            if (notice.showReconnect) {
                OutlinedButton(onClick = { reconnectOpen = true; reconnectCode = null; reconnectCopied = false }, modifier = Modifier.padding(top = 10.dp)) {
                    Text("Reconnect")
                }
            }
            TextButton(onClick = { detailsExpanded = !detailsExpanded }, modifier = Modifier.padding(top = 4.dp)) {
                Text(notice.detailsLabel)
            }
            if (detailsExpanded) {
                Column(modifier = Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    notice.steps.forEachIndexed { index, step ->
                        Text("${index + 1}. $step", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }

    Text(if (sources.size > 1) "Cameras" else "Camera", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    Text("Live view and source information.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    sources.forEach { source ->
        val active = source.id == activeSource.id
        BeaconPanel(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.Cameraswitch,
                        null,
                        tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                        Text(source.name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            when (source.facing.lowercase()) {
                                "front" -> "Front source"
                                "back", "rear" -> "Rear source"
                                else -> "Camera source"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (active) BeaconStatusPill("ACTIVE", BeaconOnline) else OutlinedButton(enabled = online && !privacyMode && !busy, onClick = { onActivate(source) }) { Text("Use") }
                    if (canManageSettings) {
                        IconButton(onClick = { renamingCameraId = source.id; renameCameraText = source.name }) {
                            Icon(Icons.Outlined.Edit, "Rename ${source.name}", modifier = Modifier.size(20.dp))
                        }
                        IconButton(onClick = { deleteCameraTarget = source }) {
                            Icon(Icons.Outlined.Delete, "Remove ${source.name}", tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
                        }
                    }
                }
            }
            Button(
                enabled = source.available && !busy,
                onClick = { onView(source) },
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            ) {
                Icon(Icons.Outlined.Videocam, null, modifier = Modifier.size(18.dp))
                Text("View live", modifier = Modifier.padding(start = 7.dp))
            }
        }
    }

    if (device.platform == "android") {
        BeaconPanel(modifier = Modifier.fillMaxWidth()) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Privacy", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text("Pause capture from every camera on this phone.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = privacyMode, enabled = (online || privacyMode) && !busy, onCheckedChange = { onPrivacyChange(!privacyMode) })
            }
            Text(
                "Local privacy is the fastest way to stop camera and microphone capture.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }

    motionContent()

    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
        Text("Device information", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Column(modifier = Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            BeaconFactRow("Device", deviceKindLabel(device.platform, device.deviceType))
            BeaconFactRow(
                "Power",
                if (device.platform != "android") {
                    "Not applicable"
                } else if (device.batteryPercent == null) {
                    "Not reported"
                } else {
                    "${device.batteryPercent}%${if (device.batteryCharging) " · charging" else ""}"
                },
            )
            if (device.platform == "android") {
                BeaconFactRow("Health updated", relativeLastSeen(device.healthReportedAt))
            }
            BeaconFactRow("Capabilities", capabilitySummary(device.capabilities))
            BeaconFactRow("Software version", device.softwareVersion ?: "Not reported")
            BeaconFactRow("Access", if (device.revoked) "Revoked" else if (device.enabled) "Active" else "Disabled")
        }
    }

    if (device.canRemove) {
        BeaconPanel(modifier = Modifier.fillMaxWidth()) {
            Text("Remove camera", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
            Text(
                "Disconnects every source paired to this camera. You can pair the device again later.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(
                onClick = { removeConfirmOpen = true },
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text("Remove camera") }
        }
    }

    Text(
        "Device changes apply immediately. Motion settings save separately.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall,
    )

    if (renamingDevice) {
        AlertDialog(
            onDismissRequest = { if (!renameBusy) renamingDevice = false },
            title = { Text("Rename this camera") },
            text = {
                OutlinedTextField(
                    value = renameDeviceText,
                    onValueChange = { renameDeviceText = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            dismissButton = { TextButton(enabled = !renameBusy, onClick = { renamingDevice = false }) { Text("Cancel") } },
            confirmButton = {
                Button(
                    enabled = renameDeviceText.isNotBlank() && !renameBusy,
                    onClick = {
                        renameBusy = true
                        actionError = ""
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.renameDevice(sessionToken, device.id, renameDeviceText.trim()) } }
                            result.onSuccess {
                                renamingDevice = false
                                onChanged()
                            }.onFailure {
                                if (it is AuthorizationLostException) onAuthorizationLost() else actionError = it.userFacingMessage("This device could not be renamed")
                            }
                            renameBusy = false
                        }
                    },
                ) { Text(if (renameBusy) "Saving…" else "Save") }
            },
        )
    }

    renamingCameraId?.let { cameraId ->
        AlertDialog(
            onDismissRequest = { renamingCameraId = null },
            title = { Text("Rename this camera source") },
            text = {
                OutlinedTextField(
                    value = renameCameraText,
                    onValueChange = { renameCameraText = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            dismissButton = { TextButton(onClick = { renamingCameraId = null }) { Text("Cancel") } },
            confirmButton = {
                Button(
                    enabled = renameCameraText.isNotBlank(),
                    onClick = {
                        val name = renameCameraText.trim()
                        renamingCameraId = null
                        actionError = ""
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.renameCameraSource(sessionToken, cameraId, name) } }
                            result.onSuccess { onChanged() }.onFailure {
                                if (it is AuthorizationLostException) onAuthorizationLost() else actionError = it.userFacingMessage("This camera could not be renamed")
                            }
                        }
                    },
                ) { Text("Save") }
            },
        )
    }

    deleteCameraTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { if (!deleteCameraBusy) deleteCameraTarget = null },
            title = { Text("Remove this camera source?") },
            text = { Text("This disconnects ${target.name} only. Other sources on this device are unaffected.") },
            dismissButton = { TextButton(enabled = !deleteCameraBusy, onClick = { deleteCameraTarget = null }) { Text("Cancel") } },
            confirmButton = {
                Button(
                    enabled = !deleteCameraBusy,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    onClick = {
                        deleteCameraBusy = true
                        actionError = ""
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.removeCameraSource(sessionToken, target.id) } }
                            result.onSuccess {
                                deleteCameraTarget = null
                                onChanged()
                            }.onFailure {
                                if (it is AuthorizationLostException) onAuthorizationLost() else actionError = it.userFacingMessage("This camera could not be removed")
                            }
                            deleteCameraBusy = false
                        }
                    },
                ) { Text(if (deleteCameraBusy) "Removing…" else "Remove") }
            },
        )
    }

    if (removeConfirmOpen) {
        AlertDialog(
            onDismissRequest = { if (!removeBusy) removeConfirmOpen = false },
            title = { Text("Remove this camera?") },
            text = { Text("Disconnects every source paired to this camera. You can pair the device again later.") },
            dismissButton = { TextButton(enabled = !removeBusy, onClick = { removeConfirmOpen = false }) { Text("Cancel") } },
            confirmButton = {
                Button(
                    enabled = !removeBusy,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    onClick = {
                        removeBusy = true
                        actionError = ""
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.removeDevice(sessionToken, device.id) } }
                            result.onSuccess {
                                removeConfirmOpen = false
                                onBack()
                                onChanged()
                            }.onFailure {
                                if (it is AuthorizationLostException) onAuthorizationLost() else actionError = it.userFacingMessage("This camera could not be removed")
                            }
                            removeBusy = false
                        }
                    },
                ) { Text(if (removeBusy) "Removing…" else "Remove camera") }
            },
        )
    }

    if (reconnectOpen) {
        AlertDialog(
            onDismissRequest = { reconnectOpen = false },
            title = { Text("Reconnect this camera") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                    val code = reconnectCode
                    if (code == null) {
                        Text("Create a one-time code, then open Beacon on the camera phone and enter it to reconnect without losing its settings.")
                    } else {
                        Text("Enter this code on the camera phone within 10 minutes:")
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(code, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            TextButton(onClick = { clipboard.setText(AnnotatedString(code)); reconnectCopied = true }) { Text(if (reconnectCopied) "Copied" else "Copy") }
                        }
                    }
                }
            },
            confirmButton = {
                if (reconnectCode == null) {
                    Button(
                        enabled = !reconnectBusy,
                        onClick = {
                            reconnectBusy = true
                            scope.launch {
                                val result = withContext(Dispatchers.IO) { runCatching { api.reconnectDevicePairingCode(sessionToken, device.id) } }
                                result.onSuccess { reconnectCode = it }.onFailure {
                                    if (it is AuthorizationLostException) onAuthorizationLost() else actionError = it.userFacingMessage("A new pairing code could not be created")
                                }
                                reconnectBusy = false
                            }
                        },
                    ) { Text(if (reconnectBusy) "Creating…" else "Create code") }
                }
            },
            dismissButton = { TextButton(onClick = { reconnectOpen = false }) { Text(if (reconnectCode == null) "Cancel" else "Done") } },
        )
    }
}
@Composable
internal fun MonitorCameraGrid(
    cameras: List<BeaconApi.MonitorCamera>,
    onView: (BeaconApi.MonitorCamera) -> Unit,
    onSettings: ((BeaconApi.MonitorCamera) -> Unit)? = null,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns = monitorColumnCount(maxWidth.value)
        val gap = 12.dp
        val tileWidth = (maxWidth - gap * (columns - 1)) / columns
        Column(verticalArrangement = Arrangement.spacedBy(gap)) {
            cameras.chunked(columns).forEach { rowCameras ->
                Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                    rowCameras.forEach { camera ->
                        MonitorCameraCard(
                            camera = camera,
                            onView = { onView(camera) },
                            onSettings = onSettings?.let { settings -> { settings(camera) } },
                            modifier = Modifier.width(tileWidth),
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun AccessEventRow(
    event: BeaconApi.AccessEvent,
    currentEmail: String?,
) {
    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    accessEventLabel(event.eventType),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    accessEventTarget(event.cameraName, event.deviceName),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            BeaconStatusPill(
                accessEventStatus(event.eventType),
                accessEventColor(event.eventType),
            )
        }
        val metadata =
            listOfNotNull(
                accessEventDetail(event.eventType, event.reason),
                accessEventActor(event.eventType, event.actorEmail, currentEmail),
            ).joinToString(" · ")
        if (metadata.isNotBlank()) {
            Text(
                metadata,
                modifier = Modifier.padding(top = 10.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(friendlyAccessTime(event.occurredAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun MotionEventPreviewRow(event: BeaconApi.MotionEvent) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.primaryContainer) {
            Icon(
                Icons.Outlined.Visibility,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(8.dp).size(18.dp),
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text("Motion detected", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            Text(
                "${event.deviceName} · ${event.cameraName}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
        Text(
            friendlyAccessTime(event.occurredAt),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun accessEventColor(eventType: String): Color =
    when (eventType) {
        "live_view_started", "privacy_disabled" -> BeaconOnline
        "privacy_enabled" -> BeaconPrivacy
        "live_view_rejected", "device_credential_revoked" -> BeaconWarning
        "camera_source_deleted", "device_deleted", "device_self_removed" -> BeaconLive
        else -> BeaconOffline
    }

@Composable
private fun MonitorCameraCard(
    camera: BeaconApi.MonitorCamera,
    onView: () -> Unit,
    onSettings: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val available = camera.online && !camera.privacyMode
    Column(
        modifier =
            modifier
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(BeaconRadii.Lg))
                .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(BeaconRadii.Lg))
                .clip(RoundedCornerShape(BeaconRadii.Lg))
                .clickable(
                    enabled = available,
                    onClickLabel = "View ${camera.name} live",
                    role = Role.Button,
                    onClick = onView,
                )
                .semantics {
                    contentDescription =
                        "${camera.name}, camera on ${camera.deviceName}, " +
                            when {
                                camera.privacyMode -> "privacy on"
                                camera.online -> "online, open live view"
                                else -> "offline"
                            }
                },
    ) {
        Box(
            modifier =
                Modifier.fillMaxWidth()
                    .aspectRatio(16f / 9f)
                    .background(Color(0xFF172437)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (camera.privacyMode) Icons.Outlined.Lock else Icons.Outlined.Videocam,
                null,
                tint = Color(0xFF7FA3C9),
                modifier = Modifier.size(42.dp),
            )
            BeaconStatusPill(
                when {
                    camera.privacyMode -> "PRIVACY ON"
                    camera.viewerCount > 0 -> "LIVE"
                    camera.online -> "READY"
                    else -> "OFFLINE"
                },
                when {
                    camera.privacyMode -> Color(0xFFA78BFA)
                    camera.viewerCount > 0 -> Color(0xFFF87171)
                    camera.online -> Color(0xFF34D399)
                    else -> Color(0xFF8291AB)
                },
                Modifier.align(Alignment.TopStart).padding(10.dp),
            )
            if (camera.viewerCount > 0) {
                Surface(
                    modifier = Modifier.align(Alignment.TopEnd).padding(10.dp),
                    shape = RoundedCornerShape(999.dp),
                    color = Color.Black.copy(alpha = 0.65f),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.Visibility, null, tint = Color.White, modifier = Modifier.size(14.dp))
                        Text(camera.viewerCount.toString(), color = Color.White, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(camera.deviceName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                if (onSettings != null) {
                    IconButton(onClick = onSettings, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.Settings, "Settings for ${camera.deviceName}", modifier = Modifier.size(20.dp))
                    }
                }
            }
            Text(camera.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!available) {
                Text(
                    if (camera.privacyMode) "Open settings to turn privacy mode off." else "Waiting for camera to reconnect.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 5.dp),
                )
            }
        }
    }
}
