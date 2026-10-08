package com.beaconsecureview.camera

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Mirrors the PWA's `MotionEventList.tsx` discriminated union
 * (`MotionEvent | HouseholdEvent`, told apart by `eventType === undefined`).
 * A sealed interface makes the same distinction exhaustive in Kotlin. */
internal sealed interface ActivityFeedEvent {
    val id: String
    val occurredAt: String
}

internal data class MotionActivityEvent(val event: BeaconApi.MotionEvent) : ActivityFeedEvent {
    override val id: String get() = event.id
    override val occurredAt: String get() = event.occurredAt
}

internal data class HouseholdActivityFeedEvent(val event: BeaconApi.HouseholdActivityEvent) : ActivityFeedEvent {
    override val id: String get() = event.id
    override val occurredAt: String get() = event.occurredAt
}

/** Verbatim port of the PWA's `activityLabels` map (MotionEventList.tsx). */
private val activityLabels: Map<String, String> = mapOf(
    "camera_source_added" to "Camera source added",
    "camera_source_deleted" to "Camera source removed",
    "camera_source_updated" to "Camera source updated",
    "camera_updated" to "Camera updated",
    "device_paired" to "Device paired",
    "device_reconnected" to "Device reconnected",
    "device_offline" to "Device went offline",
    "device_recovered" to "Device recovered",
    "device_updated" to "Device updated",
    "device_deleted" to "Device removed",
    "device_credential_revoked" to "Device access revoked",
    "device_self_removed" to "Device removed itself",
    "device_self_disconnected" to "Device disconnected",
    "privacy_enabled" to "Privacy mode enabled",
    "privacy_disabled" to "Privacy mode disabled",
    "household_invitation_created" to "Invitation created",
    "household_invitation_resent" to "Invitation resent",
    "household_invitation_accepted" to "Invitation accepted",
    "household_invitation_revoked" to "Invitation revoked",
    "household_member_removed" to "Member removed",
    "household_member_revoked" to "Member access revoked",
    "household_camera_grants_changed" to "Camera access changed",
    "camera_access_left" to "Camera access left",
    "recording_requested" to "Recording requested",
    "recording_available" to "Recording available",
    "recording_failed" to "Recording failed",
    "recording_deleted" to "Recording deleted",
    "live_view_started" to "Live view started",
    "live_view_rejected" to "Live view rejected",
    "motion_settings_changed" to "Motion settings changed",
    "motion_history_cleared" to "Motion history cleared",
    "motion_retention_changed" to "Motion retention changed",
    "notification_preference_changed" to "Notification preferences changed",
    "notification_subscription_created" to "Notification delivery enabled",
    "notification_subscription_revoked" to "Notification delivery disabled",
)

internal fun activityLabel(event: ActivityFeedEvent): String =
    when (event) {
        is MotionActivityEvent -> "Motion detected"
        is HouseholdActivityFeedEvent -> {
            val raw = event.event
            when {
                raw.eventType == "camera_updated" && !raw.metadata["cameraName"].isNullOrBlank() -> "Camera renamed"
                raw.eventType == "device_updated" && !raw.metadata["deviceName"].isNullOrBlank() -> "Device renamed"
                else -> activityLabels[raw.eventType] ?: raw.eventType.replace('_', ' ')
            }
        }
    }

internal fun activityDeviceName(event: ActivityFeedEvent): String =
    when (event) {
        is MotionActivityEvent -> event.event.deviceName.ifBlank { "Household" }
        is HouseholdActivityFeedEvent -> event.event.deviceName?.takeIf { it.isNotBlank() } ?: "Household"
    }

internal fun activitySourceName(event: ActivityFeedEvent): String? =
    when (event) {
        is MotionActivityEvent -> event.event.cameraName
        is HouseholdActivityFeedEvent -> event.event.sourceName
    }

internal enum class ActivityKindFilter(val label: String) {
    All("All"),
    Motion("Motion"),
    Household("Household"),
}

internal fun activityKindCounts(events: List<ActivityFeedEvent>): Map<ActivityKindFilter, Int> =
    mapOf(
        ActivityKindFilter.All to events.size,
        ActivityKindFilter.Motion to events.count { it is MotionActivityEvent },
        ActivityKindFilter.Household to events.count { it is HouseholdActivityFeedEvent },
    )

internal enum class ActivitySortOrder(val label: String) {
    Newest("Newest first"),
    Oldest("Oldest first"),
    Type("Event type"),
    Device("Device"),
}

/** Mirrors the PWA's `filteredEvents` memo exactly: camera filter, kind
 * filter, free-text search across device/source/actor/label, then sort.
 * The web additionally re-applies its time-range filter client-side as a
 * belt-and-suspenders check on top of the server query -- Android relies on
 * the server's `since` parameter alone rather than duplicating that check. */
internal fun filteredActivityEvents(
    events: List<ActivityFeedEvent>,
    cameraFilter: String?,
    kindFilter: ActivityKindFilter,
    search: String,
    sortOrder: ActivitySortOrder,
): List<ActivityFeedEvent> {
    var result = events
    if (cameraFilter != null) {
        result = result.filter { event ->
            when (event) {
                is MotionActivityEvent -> event.event.cameraId == cameraFilter
                is HouseholdActivityFeedEvent -> event.event.cameraSourceId == cameraFilter
            }
        }
    }
    if (kindFilter != ActivityKindFilter.All) {
        result = result.filter { event ->
            if (kindFilter == ActivityKindFilter.Motion) event is MotionActivityEvent else event is HouseholdActivityFeedEvent
        }
    }
    val trimmedSearch = search.trim().lowercase(Locale.getDefault())
    if (trimmedSearch.isNotEmpty()) {
        result = result.filter { event ->
            activityDeviceName(event).lowercase(Locale.getDefault()).contains(trimmedSearch) ||
                (activitySourceName(event) ?: "").lowercase(Locale.getDefault()).contains(trimmedSearch) ||
                ((event as? HouseholdActivityFeedEvent)?.event?.actorEmail ?: "")
                    .lowercase(Locale.getDefault()).contains(trimmedSearch) ||
                activityLabel(event).lowercase(Locale.getDefault()).contains(trimmedSearch)
        }
    }
    return when (sortOrder) {
        ActivitySortOrder.Oldest -> result.sortedBy { it.occurredAt }
        ActivitySortOrder.Type ->
            result.sortedWith(compareBy<ActivityFeedEvent> { activityLabel(it) }.thenByDescending { it.occurredAt })
        ActivitySortOrder.Device ->
            result.sortedWith(compareBy<ActivityFeedEvent> { activityDeviceName(it) }.thenByDescending { it.occurredAt })
        ActivitySortOrder.Newest -> result.sortedByDescending { it.occurredAt }
    }
}

/** Mirrors the PWA's day-grouping: "Today"/"Yesterday" special-cased, else
 * a full weekday/month/day label. */
internal fun activityDayLabel(occurredAt: String, today: LocalDate = LocalDate.now()): String {
    val date =
        runCatching { Instant.parse(occurredAt).atZone(ZoneId.systemDefault()).toLocalDate() }
            .getOrNull() ?: return occurredAt
    return when (date) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> date.format(DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy", Locale.getDefault()))
    }
}

/** Groups already-sorted events under their day label, preserving order --
 * mirrors the PWA's `groups` Map built while iterating `filteredEvents`. */
internal fun groupActivityByDay(events: List<ActivityFeedEvent>): List<Pair<String, List<ActivityFeedEvent>>> {
    val groups = LinkedHashMap<String, MutableList<ActivityFeedEvent>>()
    for (event in events) {
        groups.getOrPut(activityDayLabel(event.occurredAt)) { mutableListOf() }.add(event)
    }
    return groups.map { (label, items) -> label to items }
}

internal fun formatActivityTime(occurredAt: String): String =
    runCatching {
        DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())
            .withZone(ZoneId.systemDefault())
            .format(Instant.parse(occurredAt))
    }.getOrDefault("")

internal fun formatActivityFullDate(occurredAt: String): String =
    runCatching {
        DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy 'at' h:mm a", Locale.getDefault())
            .withZone(ZoneId.systemDefault())
            .format(Instant.parse(occurredAt))
    }.getOrDefault(occurredAt)
