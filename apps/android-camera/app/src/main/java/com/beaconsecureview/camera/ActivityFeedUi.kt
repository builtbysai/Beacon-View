package com.beaconsecureview.camera

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Mirrors the PWA's `MotionEventList.tsx` ("v3" activity feed): merges
 * motion events with the household audit feed, then filters (camera, time,
 * kind, search), sorts, and groups the result by day. Owns all of its
 * network/filter state internally, matching this file's siblings
 * (HouseholdSharingPanel.kt, RecordingLibrary.kt) rather than hoisting it
 * into the already-large MonitorHome. */
@Composable
internal fun BeaconActivityFeed(
    api: BeaconApi,
    sessionToken: String,
    cameras: List<BeaconApi.MonitorCamera>,
    includeHouseholdActivity: Boolean,
    canClearHistory: Boolean,
    onOpenCamera: (String) -> Unit,
    onViewClip: (String) -> Unit,
    onAuthorizationLost: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    var motionEvents by remember { mutableStateOf<List<BeaconApi.MotionEvent>>(emptyList()) }
    var motionCursor by remember { mutableStateOf<String?>(null) }
    var householdEvents by remember { mutableStateOf<List<BeaconApi.HouseholdActivityEvent>>(emptyList()) }
    var householdOffset by remember { mutableStateOf(0) }
    var householdTotal by remember { mutableStateOf(0) }
    var loaded by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    var search by remember { mutableStateOf("") }
    var cameraFilter by remember { mutableStateOf<String?>(null) }
    var timeFilterDays by remember { mutableStateOf<Int?>(1) }
    var kindFilter by remember { mutableStateOf(ActivityKindFilter.All) }
    var sortOrder by remember { mutableStateOf(ActivitySortOrder.Newest) }
    var showLearn by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    var clearing by remember { mutableStateOf(false) }
    var drawerEvent by remember { mutableStateOf<ActivityFeedEvent?>(null) }
    var cameraMenuOpen by remember { mutableStateOf(false) }
    var timeMenuOpen by remember { mutableStateOf(false) }
    var sortMenuOpen by remember { mutableStateOf(false) }

    fun sinceIso(): String? =
        timeFilterDays?.let { days ->
            java.time.Instant.now().minusSeconds(days * 86_400L).toString()
        }

    fun load() {
        loaded = false
        error = ""
        scope.launch {
            val since = sinceIso()
            val motionResult =
                withContext(Dispatchers.IO) {
                    runCatching { api.motionEvents(sessionToken, cameraId = cameraFilter, since = since, limit = 50) }
                }
            val householdResult =
                if (includeHouseholdActivity) {
                    withContext(Dispatchers.IO) {
                        runCatching { api.householdActivity(sessionToken, limit = 50, offset = 0, cameraId = cameraFilter, since = since) }
                    }
                } else {
                    Result.success(BeaconApi.HouseholdActivityPage(emptyList(), 0))
                }
            val failure = motionResult.exceptionOrNull() ?: householdResult.exceptionOrNull()
            if (failure is AuthorizationLostException) {
                onAuthorizationLost()
                return@launch
            }
            motionResult.onSuccess {
                motionEvents = it.events
                motionCursor = it.nextCursor
            }
            householdResult.onSuccess {
                householdEvents = it.events
                householdOffset = it.events.size
                householdTotal = it.total
            }
            if (failure != null && motionResult.isFailure && householdResult.isFailure) {
                error = failure.userFacingMessage("Activity could not be loaded. Your history is still saved.")
            }
            loaded = true
        }
    }

    fun loadMore() {
        loadingMore = true
        scope.launch {
            val since = sinceIso()
            val motionResult =
                if (motionCursor != null) {
                    withContext(Dispatchers.IO) {
                        runCatching { api.motionEvents(sessionToken, cameraId = cameraFilter, since = since, cursor = motionCursor, limit = 50) }
                    }
                } else {
                    null
                }
            val householdResult =
                if (includeHouseholdActivity && householdOffset < householdTotal) {
                    withContext(Dispatchers.IO) {
                        runCatching {
                            api.householdActivity(sessionToken, limit = 50, offset = householdOffset, cameraId = cameraFilter, since = since)
                        }
                    }
                } else {
                    null
                }
            val failure = motionResult?.exceptionOrNull() ?: householdResult?.exceptionOrNull()
            if (failure is AuthorizationLostException) {
                onAuthorizationLost()
                return@launch
            }
            motionResult?.onSuccess {
                val existing = motionEvents.map { event -> event.id }.toSet()
                motionEvents = motionEvents + it.events.filter { event -> event.id !in existing }
                motionCursor = it.nextCursor
            }
            householdResult?.onSuccess {
                val existing = householdEvents.map { event -> event.id }.toSet()
                householdEvents = householdEvents + it.events.filter { event -> event.id !in existing }
                householdOffset += it.events.size
                householdTotal = it.total
            }
            loadingMore = false
        }
    }

    LaunchedEffect(sessionToken, cameraFilter, timeFilterDays) { load() }

    val allEvents: List<ActivityFeedEvent> =
        motionEvents.map { MotionActivityEvent(it) } + householdEvents.map { HouseholdActivityFeedEvent(it) }
    val visibleEvents = filteredActivityEvents(allEvents, null, kindFilter, search, sortOrder)
    val kindCounts = activityKindCounts(allEvents)
    val groups = groupActivityByDay(visibleEvents)
    val hasMore = motionCursor != null || householdOffset < householdTotal

    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Text(
                "A chronological feed of events detected by your devices. What appears here depends on each device's capabilities.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { showLearn = !showLearn }) {
                Icon(Icons.Outlined.Info, null, modifier = Modifier.size(16.dp))
                Text("How detection works", modifier = Modifier.padding(start = 4.dp))
            }
        }
        if (showLearn) {
            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                Text("About event detection", fontWeight = FontWeight.Bold)
                Text(
                    "Basic motion is detected from visual changes in the camera view. Lighting, shadows, reflections, or moving objects can trigger it.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Text(
                    "A basic motion event does not mean Beacon identified a person or object. Beacon currently reports visual motion only; more specific labels such as Person or Vehicle will only appear here once a connected device explicitly supports that detection.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Text(
                    "Beacon's current privacy model stores event metadata rather than an image or recording, unless a clip was separately recorded.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }

        OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Search activity") },
            leadingIcon = { Icon(Icons.Outlined.Search, null) },
            singleLine = true,
        )

        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val cameraLabel = cameras.find { it.id == cameraFilter }?.deviceName ?: "All devices"
            Box(modifier = Modifier.weight(1f)) {
                OutlinedButton(onClick = { cameraMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(cameraLabel, maxLines = 1)
                }
                DropdownMenu(expanded = cameraMenuOpen, onDismissRequest = { cameraMenuOpen = false }) {
                    DropdownMenuItem(text = { Text("All devices") }, onClick = { cameraFilter = null; cameraMenuOpen = false })
                    cameras.forEach { camera ->
                        DropdownMenuItem(
                            text = { Text(camera.deviceName) },
                            onClick = { cameraFilter = camera.id; cameraMenuOpen = false },
                        )
                    }
                }
            }
            Box(modifier = Modifier.weight(1f)) {
                val timeLabel = when (timeFilterDays) { 1 -> "Last 24 hours"; 7 -> "Last 7 days"; else -> "All time" }
                OutlinedButton(onClick = { timeMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(timeLabel, maxLines = 1)
                }
                DropdownMenu(expanded = timeMenuOpen, onDismissRequest = { timeMenuOpen = false }) {
                    DropdownMenuItem(text = { Text("Last 24 hours") }, onClick = { timeFilterDays = 1; timeMenuOpen = false })
                    DropdownMenuItem(text = { Text("Last 7 days") }, onClick = { timeFilterDays = 7; timeMenuOpen = false })
                    DropdownMenuItem(text = { Text("All time") }, onClick = { timeFilterDays = null; timeMenuOpen = false })
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(ActivityKindFilter.All, ActivityKindFilter.Motion, ActivityKindFilter.Household).forEach { kind ->
                FilterChip(
                    selected = kindFilter == kind,
                    onClick = { kindFilter = kind },
                    label = { Text("${kind.label} ${kindCounts[kind] ?: 0}") },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    ),
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "${visibleEvents.size} ${if (visibleEvents.size == 1) "event" else "events"}",
                fontWeight = FontWeight.Bold,
            )
            Box {
                TextButton(onClick = { sortMenuOpen = true }) { Text("Sort: ${sortOrder.label}") }
                DropdownMenu(expanded = sortMenuOpen, onDismissRequest = { sortMenuOpen = false }) {
                    ActivitySortOrder.entries.forEach { order ->
                        DropdownMenuItem(text = { Text(order.label) }, onClick = { sortOrder = order; sortMenuOpen = false })
                    }
                }
            }
        }

        if (error.isNotBlank()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(error, color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = { load() }) { Text("Retry loading activity") }
            }
        }

        if (!loaded) {
            Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else if (visibleEvents.isEmpty()) {
            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                Text(
                    if (cameras.isEmpty()) "No activity yet." else "No matching activity",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    if (cameras.isEmpty()) "Activity will appear here after you connect a camera." else "No activity matches these filters.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        groups.forEach { (day, entries) ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(day, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                entries.forEach { event -> BeaconActivityRow(event, onClick = { drawerEvent = event }) }
            }
        }

        if (loaded && allEvents.isNotEmpty()) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                if (hasMore) {
                    OutlinedButton(enabled = !loadingMore, onClick = { loadMore() }) {
                        Text(if (loadingMore) "Loading…" else "Load more")
                    }
                }
                if (motionEvents.isNotEmpty() && canClearHistory) {
                    TextButton(onClick = { confirmClear = true }) { Text("Clear motion history") }
                }
            }
        }
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { if (!clearing) confirmClear = false },
            title = { Text("Clear motion history?") },
            text = { Text("This permanently deletes motion event metadata. Household activity remains. This action can't be undone.") },
            dismissButton = {
                TextButton(enabled = !clearing, onClick = { confirmClear = false }) { Text("Cancel") }
            },
            confirmButton = {
                TextButton(
                    enabled = !clearing,
                    onClick = {
                        clearing = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.clearMotionEvents(sessionToken) } }
                            result.onSuccess {
                                motionEvents = emptyList()
                                motionCursor = null
                            }.onFailure {
                                if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("Motion history could not be cleared. Try clearing it again.")
                            }
                            clearing = false
                            confirmClear = false
                        }
                    },
                ) { Text(if (clearing) "Clearing…" else "Clear history") }
            },
        )
    }

    drawerEvent?.let { event ->
        BeaconActivityDetailDialog(
            event = event,
            cameras = cameras,
            onDismiss = { drawerEvent = null },
            onOpenCamera = { id ->
                drawerEvent = null
                onOpenCamera(id)
            },
            onViewClip = { recordingId ->
                drawerEvent = null
                onViewClip(recordingId)
            },
        )
    }
}

@Composable
private fun BeaconActivityRow(event: ActivityFeedEvent, onClick: () -> Unit) {
    BeaconPanel(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(activityLabel(event), fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f, fill = false))
                    Text(formatActivityTime(event.occurredAt), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    if (event is MotionActivityEvent && event.event.recordingStatus != null) {
                        BeaconClipTag(event.event.recordingStatus)
                    }
                }
                val secondary = buildString {
                    append(activityDeviceName(event))
                    if (event is MotionActivityEvent) {
                        append(" · ")
                        append(event.event.cameraName)
                        append(" · ")
                        append("${(event.event.confidence * 100).toInt()}% intensity")
                    } else {
                        activitySourceName(event)?.let { append(" · "); append(it) }
                    }
                }
                Text(secondary, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
            androidx.compose.material3.IconButton(onClick = onClick) {
                Icon(Icons.Outlined.ChevronRight, "View details")
            }
        }
    }
}

@Composable
private fun BeaconClipTag(status: String) {
    val label = if (recordingStatusTone(status) == RecordingStatusTone.Link) "View clip" else recordingStatusLabel(status)
    Text(
        label,
        color = when (recordingStatusTone(status)) {
            RecordingStatusTone.Link -> MaterialTheme.colorScheme.primary
            RecordingStatusTone.Failed -> MaterialTheme.colorScheme.error
            RecordingStatusTone.Pending -> MaterialTheme.colorScheme.onSurfaceVariant
        },
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
    )
}

@Composable
private fun BeaconActivityDetailDialog(
    event: ActivityFeedEvent,
    cameras: List<BeaconApi.MonitorCamera>,
    onDismiss: () -> Unit,
    onOpenCamera: (String) -> Unit,
    onViewClip: (String) -> Unit,
) {
    val hasClip = event is MotionActivityEvent && event.event.recordingStatus == "available" && event.event.recordingId != null
    val cameraIdToOpen: String? =
        when (event) {
            is MotionActivityEvent -> event.event.cameraId
            is HouseholdActivityFeedEvent ->
                event.event.cameraSourceId?.takeIf { id -> cameras.any { it.id == id } }
        }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(activityLabel(event)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(formatActivityFullDate(event.occurredAt), color = MaterialTheme.colorScheme.onSurfaceVariant)
                BeaconFactRow("Device", activityDeviceName(event))
                activitySourceName(event)?.let { BeaconFactRow("Source", it) }
                if (event is HouseholdActivityFeedEvent) {
                    event.event.actorEmail?.let { BeaconFactRow("Actor", it) }
                }
                BeaconFactRow("Event type", activityLabel(event).removeSuffix(" detected"))
                if (event is MotionActivityEvent) {
                    BeaconFactRow("Motion intensity", "${(event.event.confidence * 100).toInt()}%")
                    event.event.recordingStatus?.let { BeaconFactRow("Clip", recordingStatusLabel(it)) }
                }
                if (event is MotionActivityEvent) {
                    Text(
                        "Motion is based on visual changes in the camera view. Lighting, shadows, reflections, or moving objects can trigger it. A motion event does not mean Beacon identified a person or object.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        },
        confirmButton = {
            if (hasClip) {
                Button(onClick = { onViewClip((event as MotionActivityEvent).event.recordingId!!) }) { Text("View clip") }
            } else if (cameraIdToOpen != null) {
                Button(onClick = { onOpenCamera(cameraIdToOpen) }) { Text("Open ${activityDeviceName(event)}") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Back to activity") } },
    )
}

