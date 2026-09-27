package com.beaconsecureview.camera

import android.app.TimePickerDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.ZoneId

@Composable
internal fun AndroidMotionSettingsPanel(
    sources: List<BeaconApi.MonitorCamera>,
    settings: List<BeaconApi.CameraMotionSettings>,
    loaded: Boolean,
    busy: Boolean,
    error: String,
    notice: String,
    onChange: (BeaconApi.CameraMotionSettings) -> Unit,
    onSave: (BeaconApi.CameraMotionSettings) -> Unit,
    onRetry: () -> Unit,
) {
    val context = LocalContext.current
    var selectedCameraId by rememberSaveable(sources.first().deviceId) { mutableStateOf("") }
    var sourceMenuOpen by rememberSaveable { mutableStateOf(false) }
    var sensitivityMenuOpen by rememberSaveable { mutableStateOf(false) }
    var cooldownMenuOpen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(settings) {
        if (settings.none { it.cameraId == selectedCameraId }) {
            selectedCameraId = settings.firstOrNull()?.cameraId.orEmpty()
        }
    }
    val active = settings.firstOrNull { it.cameraId == selectedCameraId }
    val activeSource = sources.firstOrNull { it.id == selectedCameraId }

    BeaconSectionHeader("Motion", "Detection controls for this camera. Motion creates activity metadata only.")
    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
        when {
            !loaded -> Text("Loading motion settings…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            error.isNotBlank() && active == null -> {
                Text(error, color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = onRetry, modifier = Modifier.fillMaxWidth().padding(top = BeaconSpacing.Md)) {
                    Text("Retry motion settings")
                }
            }
            active == null -> Text("Motion settings are unavailable for this device.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> {
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                if (settings.size > 1) {
                    MotionSettingRow("Camera", "Choose the source to configure.") {
                        Column(horizontalAlignment = Alignment.End) {
                            OutlinedButton(enabled = !busy, onClick = { sourceMenuOpen = true }) {
                                Text(activeSource?.name ?: "Camera")
                            }
                            DropdownMenu(expanded = sourceMenuOpen, onDismissRequest = { sourceMenuOpen = false }) {
                                settings.forEach { item ->
                                    DropdownMenuItem(
                                        text = { Text(sources.firstOrNull { it.id == item.cameraId }?.name ?: "Camera") },
                                        onClick = {
                                            selectedCameraId = item.cameraId
                                            sourceMenuOpen = false
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
                MotionSettingRow("Motion detection", "Create motion events when activity is detected.") {
                    Switch(
                        checked = active.enabled,
                        enabled = !busy,
                        onCheckedChange = { onChange(active.copy(enabled = it)) },
                    )
                }
                MotionSettingRow("Sensitivity", "How readily motion creates an event.") {
                    Column(horizontalAlignment = Alignment.End) {
                        OutlinedButton(enabled = !busy && active.enabled, onClick = { sensitivityMenuOpen = true }) {
                            Text(active.sensitivity.name)
                        }
                        DropdownMenu(expanded = sensitivityMenuOpen, onDismissRequest = { sensitivityMenuOpen = false }) {
                            MotionSensitivity.entries.forEach { sensitivity ->
                                DropdownMenuItem(
                                    text = { Text(sensitivity.name) },
                                    onClick = {
                                        onChange(active.copy(sensitivity = sensitivity))
                                        sensitivityMenuOpen = false
                                    },
                                )
                            }
                        }
                    }
                }
                MotionSettingRow("Record on motion", "Save a short clip when motion is detected.") {
                    Switch(
                        checked = active.recordOnMotion,
                        enabled = !busy && active.enabled,
                        onCheckedChange = { onChange(active.copy(recordOnMotion = it)) },
                    )
                }
                MotionSettingRow("Time between events", "Minimum delay before another event can be created.") {
                    Column(horizontalAlignment = Alignment.End) {
                        OutlinedButton(enabled = !busy && active.enabled, onClick = { cooldownMenuOpen = true }) {
                            Text(motionCooldownLabel(active.cooldownSeconds))
                        }
                        DropdownMenu(expanded = cooldownMenuOpen, onDismissRequest = { cooldownMenuOpen = false }) {
                            listOf(30, 60, 120, 300).forEach { seconds ->
                                DropdownMenuItem(
                                    text = { Text(motionCooldownLabel(seconds)) },
                                    onClick = {
                                        onChange(active.copy(cooldownSeconds = seconds))
                                        cooldownMenuOpen = false
                                    },
                                )
                            }
                        }
                    }
                }
                MotionSettingRow("Quiet hours", "Pause motion events on a daily schedule.") {
                    Switch(
                        checked = active.quietHours != null,
                        enabled = !busy && active.enabled,
                        onCheckedChange = { enabled ->
                            onChange(
                                active.copy(
                                    quietHours =
                                        if (enabled) QuietHours("22:00", "07:00", ZoneId.systemDefault().id)
                                        else null,
                                ),
                            )
                        },
                    )
                }
                active.quietHours?.let { quiet ->
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                        OutlinedButton(
                            enabled = !busy && active.enabled,
                            onClick = {
                                showMotionTimePicker(context, quiet.start) { time ->
                                    if (time != quiet.end) onChange(active.copy(quietHours = QuietHours(time, quiet.end, quiet.timeZone)))
                                }
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text("Start ${quiet.start}") }
                        OutlinedButton(
                            enabled = !busy && active.enabled,
                            onClick = {
                                showMotionTimePicker(context, quiet.end) { time ->
                                    if (time != quiet.start) onChange(active.copy(quietHours = QuietHours(quiet.start, time, quiet.timeZone)))
                                }
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text("End ${quiet.end}") }
                    }
                    Text(
                        "Time zone: ${quiet.timeZone.replace('_', ' ')}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (notice.isNotBlank()) Text(notice, color = BeaconOnline)
                Button(
                    enabled = !busy,
                    onClick = { onSave(active) },
                    modifier = Modifier.fillMaxWidth().padding(top = BeaconSpacing.Md),
                ) { Text(if (busy) "Saving…" else "Save motion settings") }
            }
        }
    }
}

@Composable
private fun MotionSettingRow(
    title: String,
    supportingText: String,
    control: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = BeaconSpacing.Sm),
        horizontalArrangement = Arrangement.spacedBy(BeaconSpacing.Md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(supportingText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        control()
    }
}

internal fun motionCooldownLabel(seconds: Int): String =
    when (seconds) {
        30 -> "30 seconds"
        60 -> "1 minute"
        120 -> "2 minutes"
        300 -> "5 minutes"
        else -> "$seconds seconds"
    }

private fun showMotionTimePicker(
    context: android.content.Context,
    value: String,
    onSelected: (String) -> Unit,
) {
    val (hour, minute) = value.split(':').map(String::toInt)
    TimePickerDialog(
        context,
        { _, selectedHour, selectedMinute -> onSelected("%02d:%02d".format(selectedHour, selectedMinute)) },
        hour,
        minute,
        true,
    ).show()
}
