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
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
internal fun MonitorDeviceSettings(
    sources: List<BeaconApi.MonitorCamera>,
    busy: Boolean,
    onBack: () -> Unit,
    onView: (BeaconApi.MonitorCamera) -> Unit,
    onActivate: (BeaconApi.MonitorCamera) -> Unit,
    onPrivacyChange: (Boolean) -> Unit,
    motionContent: @Composable () -> Unit = {},
) {
    val device = sources.first()
    val activeSource = sources.firstOrNull { it.available } ?: device
    val online = sources.any { it.online }
    val privacyMode = sources.any { it.privacyMode }

    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to cameras")
        }
        BeaconWordmark(compact = true)
    }
    BeaconPageHeader(
        eyebrow = "Camera settings",
        title = device.deviceName,
        supportingText = "Manage this device and choose which camera is active.",
    )
    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
        Text("DEVICE STATUS", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        Text(
            when {
                privacyMode -> "Privacy mode is on"
                online -> "Ready to view"
                else -> "Camera is offline"
            },
            modifier = Modifier.padding(top = 7.dp),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            "${sources.size} camera ${if (sources.size == 1) "source" else "sources"} · ${sources.sumOf { it.viewerCount }} watching",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(
            enabled = online && !privacyMode && !busy,
            onClick = { onView(activeSource) },
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
        ) {
            Icon(Icons.Outlined.Videocam, null, modifier = Modifier.size(18.dp))
            Text("Open live view", modifier = Modifier.padding(start = 7.dp))
        }
    }

    Text("Camera source", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    Text(
        "Switching here also switches the camera device, so both sides stay in sync.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
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
                    Column(modifier = Modifier.padding(start = 12.dp)) {
                        Text(source.name, fontWeight = FontWeight.Bold)
                        Text(
                            when (source.facing.lowercase()) {
                                "front" -> "Front camera"
                                "back", "rear" -> "Rear camera"
                                else -> "Camera source"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (active) {
                    BeaconStatusPill("ACTIVE", BeaconOnline)
                } else {
                    OutlinedButton(
                        enabled = online && !privacyMode && !busy,
                        onClick = { onActivate(source) },
                    ) { Text("Use") }
                }
            }
        }
    }

    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
        Text("Privacy mode", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            if (privacyMode) "Capture is stopped on this device." else "Stop camera and microphone capture immediately.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(
            enabled = (online || privacyMode) && !busy,
            onClick = { onPrivacyChange(!privacyMode) },
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Icon(Icons.Outlined.Lock, null, modifier = Modifier.size(18.dp))
            Text(
                if (busy) "Updating…" else if (privacyMode) "Resume" else "Pause",
                modifier = Modifier.padding(start = 7.dp),
            )
        }
        BeaconTrustLine("Camera and microphone use always stays visible on the camera device.")
    }
    motionContent()
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
internal fun MotionEventRow(event: BeaconApi.MotionEvent) {
    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Motion detected", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(event.deviceName, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(event.cameraName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            BeaconStatusPill("${(event.confidence * 100).toInt()}%", BeaconWarning)
        }
        Text(
            friendlyAccessTime(event.occurredAt),
            modifier = Modifier.padding(top = 10.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
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
