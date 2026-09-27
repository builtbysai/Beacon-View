package com.beaconsecureview.camera

import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
internal fun AndroidRecordingLibrary(
    api: BeaconApi,
    sessionToken: String,
    cameras: List<BeaconApi.MonitorCamera>,
    recordings: List<BeaconApi.RecordingSummary>,
    loaded: Boolean,
    loadingMore: Boolean,
    nextCursor: String?,
    busyRecordingId: String?,
    canDelete: Boolean,
    playback: BeaconApi.PlaybackRecording?,
    deleteTarget: BeaconApi.RecordingSummary?,
    shareTarget: BeaconApi.RecordingSummary?,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onPlay: (BeaconApi.RecordingSummary) -> Unit,
    onRequestDelete: (BeaconApi.RecordingSummary) -> Unit,
    onConfirmDelete: () -> Unit,
    onCancelDelete: () -> Unit,
    onClosePlayback: () -> Unit,
    onRequestShare: (BeaconApi.RecordingSummary) -> Unit,
    onDismissShare: () -> Unit,
) {
    var search by remember { mutableStateOf("") }
    var cameraFilter by remember { mutableStateOf<String?>(null) }
    var timeFilterDays by remember { mutableStateOf<Int?>(null) }
    var cameraMenuOpen by remember { mutableStateOf(false) }
    var timeMenuOpen by remember { mutableStateOf(false) }

    Text(
        "Clips your cameras recorded, encrypted in your connected Google Drive. Playback and download happen only on this device.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedButton(onClick = onRefresh) {
        Icon(Icons.Outlined.Refresh, null)
        Text("Refresh", modifier = Modifier.padding(start = 6.dp))
    }

    if (recordings.isNotEmpty()) {
        androidx.compose.material3.OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Search clips") },
            leadingIcon = { Icon(Icons.Outlined.Search, null) },
            singleLine = true,
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val cameraLabel = cameras.find { it.id == cameraFilter }?.deviceName ?: "All devices"
            Column(modifier = Modifier.weight(1f)) {
                OutlinedButton(onClick = { cameraMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(cameraLabel, maxLines = 1)
                }
                androidx.compose.material3.DropdownMenu(expanded = cameraMenuOpen, onDismissRequest = { cameraMenuOpen = false }) {
                    androidx.compose.material3.DropdownMenuItem(text = { Text("All devices") }, onClick = { cameraFilter = null; cameraMenuOpen = false })
                    cameras.forEach { camera ->
                        androidx.compose.material3.DropdownMenuItem(
                            text = { Text(camera.deviceName) },
                            onClick = { cameraFilter = camera.id; cameraMenuOpen = false },
                        )
                    }
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                val timeLabel = when (timeFilterDays) { 1 -> "Last 24 hours"; 7 -> "Last 7 days"; else -> "All time" }
                OutlinedButton(onClick = { timeMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(timeLabel, maxLines = 1)
                }
                androidx.compose.material3.DropdownMenu(expanded = timeMenuOpen, onDismissRequest = { timeMenuOpen = false }) {
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Last 24 hours") }, onClick = { timeFilterDays = 1; timeMenuOpen = false })
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Last 7 days") }, onClick = { timeFilterDays = 7; timeMenuOpen = false })
                    androidx.compose.material3.DropdownMenuItem(text = { Text("All time") }, onClick = { timeFilterDays = null; timeMenuOpen = false })
                }
            }
        }
    }

    val visibleRecordings = filteredRecordings(recordings, cameraFilter, timeFilterDays, search)
    if (recordings.isNotEmpty()) {
        Text(
            "${visibleRecordings.size} ${if (visibleRecordings.size == 1) "clip" else "clips"}",
            fontWeight = FontWeight.Bold,
        )
    }

    when {
        !loaded -> Text("Loading recordings…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        recordings.isEmpty() -> {
            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.Movie, null)
                Text("No recorded clips yet.", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "A clip appears here once a recording finishes uploading.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        visibleRecordings.isEmpty() -> {
            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                Text("No matching clips", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("No clips match these filters.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        else -> groupRecordingsByDay(visibleRecordings).forEach { (day, entries) ->
            Text(day, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
            entries.forEach { recording ->
                RecordingRow(
                    api = api,
                    sessionToken = sessionToken,
                    recording = recording,
                    busy = busyRecordingId != null,
                    canDelete = canDelete,
                    onPlay = { onPlay(recording) },
                    onDelete = { onRequestDelete(recording) },
                    onShare = { onRequestShare(recording) },
                )
            }
        }
    }

    if (nextCursor != null) {
        OutlinedButton(
            enabled = !loadingMore,
            onClick = onLoadMore,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (loadingMore) "Loading…" else "Load more") }
    }

    playback?.let { clip -> RecordingPlaybackDialog(clip, onClosePlayback) }
    deleteTarget?.let { clip ->
        AlertDialog(
            onDismissRequest = onCancelDelete,
            title = { Text("Delete this clip?") },
            text = { Text("This permanently deletes the encrypted clip from your Google Drive. This cannot be undone.") },
            confirmButton = {
                Button(
                    enabled = busyRecordingId == null,
                    onClick = onConfirmDelete,
                ) { Text(if (busyRecordingId == clip.id) "Deleting…" else "Delete clip") }
            },
            dismissButton = { TextButton(onClick = onCancelDelete) { Text("Cancel") } },
        )
    }
    shareTarget?.let { clip ->
        ShareClipDialog(
            api = api,
            sessionToken = sessionToken,
            recordingId = clip.id,
            cameraName = clip.cameraName,
            onDismiss = onDismissShare,
        )
    }
}

@Composable
private fun RecordingRow(
    api: BeaconApi,
    sessionToken: String,
    recording: BeaconApi.RecordingSummary,
    busy: Boolean,
    canDelete: Boolean,
    onPlay: () -> Unit,
    onDelete: () -> Unit,
    onShare: () -> Unit,
) {
    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
        if (recording.status == "available" && recording.hasThumbnail) {
            RecordingThumbnailImage(api = api, sessionToken = sessionToken, recordingId = recording.id)
        }
        Text(recording.cameraName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            "${recording.deviceName} · ${formatRecordingTime(recording.createdAt)}",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        formatRecordingDuration(recording.durationMs)?.let {
            Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (recording.status == "available") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = !busy, onClick = onPlay) {
                    Icon(Icons.Outlined.PlayArrow, null)
                    Text("Play", modifier = Modifier.padding(start = 4.dp))
                }
                if (canDelete) {
                    OutlinedButton(enabled = !busy, onClick = onShare) {
                        Icon(Icons.Outlined.Share, null)
                        Text("Share", modifier = Modifier.padding(start = 4.dp))
                    }
                    OutlinedButton(enabled = !busy, onClick = onDelete) {
                        Icon(Icons.Outlined.Delete, null, tint = MaterialTheme.colorScheme.error)
                        Text("Delete", modifier = Modifier.padding(start = 4.dp), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        } else {
            Text(recordingStatusLabel(recording.status), fontWeight = FontWeight.SemiBold)
            if (recording.status == "failed" && canDelete) {
                OutlinedButton(enabled = !busy, onClick = onDelete) { Text("Remove failed clip") }
            }
        }
    }
}

/** Best-effort decoration: loads and decrypts the clip's thumbnail (ADR 0078)
 * if one exists, showing nothing at all rather than an error state if it
 * doesn't -- a missing thumbnail is never a reason to block viewing the row. */
@Composable
private fun RecordingThumbnailImage(
    api: BeaconApi,
    sessionToken: String,
    recordingId: String,
) {
    val context = LocalContext.current
    var thumbnail by remember(recordingId) { mutableStateOf<BeaconApi.RecordingThumbnail?>(null) }

    LaunchedEffect(recordingId) {
        val result =
            withContext(Dispatchers.IO) {
                runCatching { api.downloadRecordingThumbnail(sessionToken, recordingId, context.cacheDir) }
            }
        thumbnail = result.getOrNull()
    }
    DisposableEffect(recordingId) {
        onDispose { thumbnail?.file?.delete() }
    }

    thumbnail?.let { loaded ->
        val bitmap = remember(loaded.file) { BitmapFactory.decodeFile(loaded.file.path)?.asImageBitmap() }
        bitmap?.let {
            Image(
                bitmap = it,
                contentDescription = null,
                modifier =
                    Modifier.fillMaxWidth().heightIn(max = 160.dp).clip(RoundedCornerShape(BeaconRadii.Md)),
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
            )
        }
    }
}

/** Owner-only: create, inspect, or revoke the one active share link for a
 * clip. The raw token/URL is only shown once, right after creation --
 * mirrors the PWA's ShareClipDialog (ADR 0077). */
@Composable
private fun ShareClipDialog(
    api: BeaconApi,
    sessionToken: String,
    recordingId: String,
    cameraName: String,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var checking by remember(recordingId) { mutableStateOf(true) }
    var activeLink by remember(recordingId) { mutableStateOf<BeaconApi.ActiveRecordingShareLink?>(null) }
    var hours by remember(recordingId) { mutableStateOf(24) }
    var consent by remember(recordingId) { mutableStateOf(false) }
    var created by remember(recordingId) { mutableStateOf<BeaconApi.RecordingShareLink?>(null) }
    var copied by remember(recordingId) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    LaunchedEffect(recordingId) {
        val result = withContext(Dispatchers.IO) { runCatching { api.activeRecordingShareLink(sessionToken, recordingId) } }
        result.onSuccess { activeLink = it }
            .onFailure { error = "Could not check for an existing link." }
        checking = false
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Share $cameraName clip") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                val link = created
                val active = activeLink
                when {
                    checking -> Text("Checking for an existing link…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    link != null -> {
                        Text("Anyone with this link can view this clip until ${formatRecordingTime(link.expiresAt)}.")
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                link.url,
                                modifier = Modifier.weight(1f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodySmall,
                            )
                            TextButton(onClick = {
                                clipboard.setText(AnnotatedString(link.url))
                                copied = true
                            }) { Text(if (copied) "Copied" else "Copy") }
                        }
                    }
                    active != null -> {
                        Text(
                            "A link for this clip is active until ${formatRecordingTime(active.expiresAt)}. " +
                                "Anyone who has it can view the clip until then.",
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                enabled = !busy,
                                onClick = {
                                    busy = true
                                    scope.launch {
                                        val result =
                                            withContext(Dispatchers.IO) {
                                                runCatching { api.revokeRecordingShareLink(sessionToken, active.id) }
                                            }
                                        result.onSuccess { activeLink = null }
                                            .onFailure { error = it.userFacingMessage("The share link could not be revoked.") }
                                        busy = false
                                    }
                                },
                            ) { Text(if (busy) "Revoking…" else "Revoke link") }
                            OutlinedButton(enabled = !busy, onClick = { activeLink = null }) { Text("Replace with a new link") }
                        }
                    }
                    else -> {
                        Text("Link expires after", style = MaterialTheme.typography.labelMedium)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(24, 48, 72).forEach { option ->
                                val optionSelected = hours == option
                                OutlinedButton(
                                    onClick = { hours = option },
                                    colors =
                                        ButtonDefaults.outlinedButtonColors(
                                            containerColor = if (optionSelected) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent,
                                        ),
                                ) { Text("${option}h") }
                            }
                        }
                        Row(verticalAlignment = Alignment.Top) {
                            Checkbox(checked = consent, onCheckedChange = { consent = it })
                            Text(
                                "I understand anyone with this link can view this clip without a Beacon " +
                                    "account until it expires or I revoke it.",
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(top = 12.dp),
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (created == null && activeLink == null && !checking) {
                Button(
                    enabled = consent && !busy,
                    onClick = {
                        busy = true
                        scope.launch {
                            val result =
                                withContext(Dispatchers.IO) {
                                    runCatching { api.createRecordingShareLink(sessionToken, recordingId, hours) }
                                }
                            result.onSuccess { created = it }
                                .onFailure { error = it.userFacingMessage("This clip could not be shared. Try again.") }
                            busy = false
                        }
                    },
                ) { Text(if (busy) "Creating…" else "Create link") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(if (created != null) "Done" else "Cancel") } },
    )
}

@Composable
private fun RecordingPlaybackDialog(
    playback: BeaconApi.PlaybackRecording,
    onClose: () -> Unit,
) {
    DisposableEffect(playback.file) {
        onDispose { playback.file.delete() }
    }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Recorded clip") },
        text = {
            AndroidView(
                modifier = Modifier.fillMaxWidth().heightIn(min = 220.dp, max = 480.dp),
                factory = { context ->
                    VideoView(context).apply {
                        val controls = MediaController(context)
                        controls.setAnchorView(this)
                        setMediaController(controls)
                        setVideoURI(Uri.fromFile(playback.file))
                        setOnPreparedListener { player ->
                            player.isLooping = false
                            start()
                        }
                    }
                },
                onRelease = { it.stopPlayback() },
            )
        },
        confirmButton = { TextButton(onClick = onClose) { Text("Close") } },
        containerColor = MaterialTheme.colorScheme.surface,
        textContentColor = Color.Unspecified,
    )
}

internal fun formatRecordingDuration(durationMs: Long?): String? {
    if (durationMs == null || durationMs <= 0) return null
    val totalSeconds = (durationMs / 1_000L).coerceAtLeast(1L)
    return "%d:%02d".format(totalSeconds / 60L, totalSeconds % 60L)
}

/** Mirrors the PWA's `RecordingLibrary.tsx` `filtered` memo: client-side
 * camera/time/search filtering then newest-first sort -- the `/api/recordings`
 * endpoint has no server-side filter params, so (like the web) this filters
 * whatever page has already loaded rather than re-querying per filter. */
internal fun filteredRecordings(
    recordings: List<BeaconApi.RecordingSummary>,
    cameraFilter: String?,
    timeFilterDays: Int?,
    search: String,
): List<BeaconApi.RecordingSummary> {
    var result = recordings
    if (cameraFilter != null) {
        result = result.filter { it.cameraId == cameraFilter }
    }
    if (timeFilterDays != null) {
        val sinceMillis = System.currentTimeMillis() - timeFilterDays * 86_400_000L
        result = result.filter {
            val createdMillis = runCatching { Instant.parse(it.createdAt).toEpochMilli() }.getOrDefault(0L)
            createdMillis >= sinceMillis
        }
    }
    val trimmedSearch = search.trim().lowercase(java.util.Locale.getDefault())
    if (trimmedSearch.isNotEmpty()) {
        result = result.filter {
            it.cameraName.lowercase(java.util.Locale.getDefault()).contains(trimmedSearch) ||
                it.deviceName.lowercase(java.util.Locale.getDefault()).contains(trimmedSearch)
        }
    }
    return result.sortedByDescending { it.createdAt }
}

/** Groups already-filtered/sorted clips under their day label, reusing the
 * Activity feed's `activityDayLabel` (Today/Yesterday/full date). */
internal fun groupRecordingsByDay(
    recordings: List<BeaconApi.RecordingSummary>,
): List<Pair<String, List<BeaconApi.RecordingSummary>>> {
    val groups = LinkedHashMap<String, MutableList<BeaconApi.RecordingSummary>>()
    for (recording in recordings) {
        groups.getOrPut(activityDayLabel(recording.createdAt)) { mutableListOf() }.add(recording)
    }
    return groups.map { (label, items) -> label to items }
}

/** Mirrors the PWA's `recording-status.ts` `recordingStatusLabels` exactly --
 * shared here between the Clips library's own status pill and the Activity
 * feed's inline clip tag, so the two views never describe the same
 * recording state two different ways. */
internal fun recordingStatusLabel(status: String): String =
    when (status) {
        "requested" -> "Recording starting"
        "recording" -> "Recording…"
        "uploading" -> "Uploading…"
        "available" -> "Ready"
        "failed" -> "Recording failed"
        "deleting" -> "Removing clip"
        else -> "Unavailable"
    }

/** Mirrors the PWA's `recordingStatusTone`: "link" once there is a clip to
 * open, "failed" when it never will be, "pending" for everything between. */
internal enum class RecordingStatusTone { Link, Pending, Failed }

internal fun recordingStatusTone(status: String): RecordingStatusTone =
    when (status) {
        "available" -> RecordingStatusTone.Link
        "failed" -> RecordingStatusTone.Failed
        else -> RecordingStatusTone.Pending
    }

internal fun formatRecordingTime(value: String): String =
    runCatching {
        DateTimeFormatter.ofPattern("MMM d, yyyy · h:mm a")
            .withZone(ZoneId.systemDefault())
            .format(Instant.parse(value))
    }.getOrDefault("Unknown time")
