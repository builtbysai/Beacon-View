package com.beaconsecureview.camera

import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals

private fun motion(
    id: String,
    cameraId: String = "cam-1",
    cameraName: String = "Front door",
    deviceName: String = "Pixel",
    occurredAt: String = "2026-09-27T12:00:00Z",
    confidence: Double = 0.8,
): MotionActivityEvent =
    MotionActivityEvent(
        BeaconApi.MotionEvent(
            id = id,
            cameraId = cameraId,
            cameraName = cameraName,
            deviceName = deviceName,
            confidence = confidence,
            occurredAt = occurredAt,
        ),
    )

private fun household(
    id: String,
    eventType: String,
    cameraSourceId: String? = "cam-1",
    deviceName: String? = "Pixel",
    sourceName: String? = "Front door",
    actorEmail: String? = "owner@example.test",
    occurredAt: String = "2026-09-27T12:00:00Z",
    metadata: Map<String, String> = emptyMap(),
): HouseholdActivityFeedEvent =
    HouseholdActivityFeedEvent(
        BeaconApi.HouseholdActivityEvent(
            id = id,
            actorEmail = actorEmail,
            deviceName = deviceName,
            cameraSourceId = cameraSourceId,
            sourceName = sourceName,
            eventType = eventType,
            occurredAt = occurredAt,
            success = true,
            metadata = metadata,
        ),
    )

class ActivityFeedPresentationTest {
    @Test
    fun activityLabelIsMotionDetectedForMotionEvents() {
        assertEquals("Motion detected", activityLabel(motion("m1")))
    }

    @Test
    fun activityLabelUsesKnownMapOrFallsBackToReplacedUnderscores() {
        assertEquals("Device paired", activityLabel(household("h1", "device_paired")))
        assertEquals(
            "some unknown type",
            activityLabel(household("h2", "some_unknown_type")),
        )
    }

    @Test
    fun activityLabelSpecialCasesRenamesWhenMetadataNamePresent() {
        assertEquals(
            "Camera renamed",
            activityLabel(household("h3", "camera_updated", metadata = mapOf("cameraName" to "Kitchen"))),
        )
        assertEquals(
            "Camera updated",
            activityLabel(household("h4", "camera_updated")),
        )
        assertEquals(
            "Device renamed",
            activityLabel(household("h5", "device_updated", metadata = mapOf("deviceName" to "Pixel"))),
        )
    }

    @Test
    fun activityDeviceNameFallsBackToHouseholdWhenBlank() {
        assertEquals("Pixel", activityDeviceName(motion("m1", deviceName = "Pixel")))
        assertEquals("Household", activityDeviceName(household("h1", "device_paired", deviceName = null)))
        assertEquals("Household", activityDeviceName(household("h2", "device_paired", deviceName = "")))
    }

    @Test
    fun filteredActivityEventsAppliesCameraFilter() {
        val events = listOf(
            motion("m1", cameraId = "cam-1"),
            motion("m2", cameraId = "cam-2"),
            household("h1", "device_paired", cameraSourceId = "cam-2"),
        )
        val result = filteredActivityEvents(events, "cam-2", ActivityKindFilter.All, "", ActivitySortOrder.Newest)
        assertEquals(listOf("m2", "h1"), result.map { it.id })
    }

    @Test
    fun filteredActivityEventsAppliesKindFilter() {
        val events = listOf(motion("m1"), household("h1", "device_paired"))
        assertEquals(listOf("m1"), filteredActivityEvents(events, null, ActivityKindFilter.Motion, "", ActivitySortOrder.Newest).map { it.id })
        assertEquals(listOf("h1"), filteredActivityEvents(events, null, ActivityKindFilter.Household, "", ActivitySortOrder.Newest).map { it.id })
    }

    @Test
    fun filteredActivityEventsSearchesAcrossDeviceSourceActorAndLabel() {
        val events = listOf(
            motion("m1", cameraName = "Front door", deviceName = "Kitchen Pixel"),
            household(
                "h1",
                "device_paired",
                deviceName = "Garage Tablet",
                sourceName = "Garage",
                actorEmail = "owner@example.test",
            ),
        )
        assertEquals(listOf("m1"), filteredActivityEvents(events, null, ActivityKindFilter.All, "front", ActivitySortOrder.Newest).map { it.id })
        assertEquals(listOf("h1"), filteredActivityEvents(events, null, ActivityKindFilter.All, "owner@", ActivitySortOrder.Newest).map { it.id })
        assertEquals(listOf("h1"), filteredActivityEvents(events, null, ActivityKindFilter.All, "paired", ActivitySortOrder.Newest).map { it.id })
    }

    @Test
    fun filteredActivityEventsSortsByEachOrder() {
        val events = listOf(
            motion("old", deviceName = "B", occurredAt = "2026-09-25T12:00:00Z"),
            motion("new", deviceName = "A", occurredAt = "2026-09-27T12:00:00Z"),
        )
        assertEquals(listOf("new", "old"), filteredActivityEvents(events, null, ActivityKindFilter.All, "", ActivitySortOrder.Newest).map { it.id })
        assertEquals(listOf("old", "new"), filteredActivityEvents(events, null, ActivityKindFilter.All, "", ActivitySortOrder.Oldest).map { it.id })
        assertEquals(listOf("new", "old"), filteredActivityEvents(events, null, ActivityKindFilter.All, "", ActivitySortOrder.Device).map { it.id })
    }

    @Test
    fun activityKindCountsCountsEachKindIndependently() {
        val events = listOf(motion("m1"), motion("m2"), household("h1", "device_paired"))
        val counts = activityKindCounts(events)
        assertEquals(3, counts[ActivityKindFilter.All])
        assertEquals(2, counts[ActivityKindFilter.Motion])
        assertEquals(1, counts[ActivityKindFilter.Household])
    }

    @Test
    fun activityDayLabelUsesTodayAndYesterdaySpecialCasing() {
        val today = LocalDate.of(2026, 9, 27)
        assertEquals("Today", activityDayLabel("2026-09-27T08:00:00Z", today))
        assertEquals("Yesterday", activityDayLabel("2026-09-26T08:00:00Z", today))
    }

    @Test
    fun groupActivityByDayPreservesOrderAndGroupsConsecutiveSameDayEvents() {
        val events = listOf(
            motion("a", occurredAt = "2026-09-27T08:00:00Z"),
            motion("b", occurredAt = "2026-09-27T09:00:00Z"),
            motion("c", occurredAt = "2026-09-25T09:00:00Z"),
        )
        val groups = groupActivityByDay(events)
        assertEquals(2, groups.size)
        assertEquals(listOf("a", "b"), groups[0].second.map { it.id })
        assertEquals(listOf("c"), groups[1].second.map { it.id })
    }
}
