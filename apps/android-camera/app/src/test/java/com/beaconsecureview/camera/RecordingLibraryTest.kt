package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private fun recording(
    id: String,
    cameraId: String = "cam-1",
    cameraName: String = "Front door",
    deviceName: String = "Pixel",
    createdAt: String = "2026-09-27T12:00:00Z",
    status: String = "available",
): BeaconApi.RecordingSummary =
    BeaconApi.RecordingSummary(
        id = id,
        cameraId = cameraId,
        cameraName = cameraName,
        deviceName = deviceName,
        status = status,
        durationMs = 5_000,
        createdAt = createdAt,
        triggerMotionEventId = null,
        hasThumbnail = false,
    )

class RecordingLibraryTest {
    @Test
    fun formatsDurationAndKnownStatuses() {
        assertNull(formatRecordingDuration(null))
        assertEquals("1:05", formatRecordingDuration(65_000))
        assertEquals("Uploading…", recordingStatusLabel("uploading"))
        assertEquals("Ready", recordingStatusLabel("available"))
        assertEquals("Unavailable", recordingStatusLabel("unexpected"))
    }

    @Test
    fun recordingStatusToneMatchesPwaExactly() {
        assertEquals(RecordingStatusTone.Link, recordingStatusTone("available"))
        assertEquals(RecordingStatusTone.Failed, recordingStatusTone("failed"))
        assertEquals(RecordingStatusTone.Pending, recordingStatusTone("uploading"))
        assertEquals(RecordingStatusTone.Pending, recordingStatusTone("requested"))
    }

    @Test
    fun filteredRecordingsAppliesCameraFilter() {
        val recordings = listOf(recording("r1", cameraId = "cam-1"), recording("r2", cameraId = "cam-2"))
        assertEquals(listOf("r2"), filteredRecordings(recordings, "cam-2", null, "").map { it.id })
    }

    @Test
    fun filteredRecordingsAppliesTimeFilter() {
        val now = java.time.Instant.now()
        val recordings = listOf(
            recording("recent", createdAt = now.minusSeconds(3_600).toString()),
            recording("old", createdAt = now.minusSeconds(10 * 86_400L).toString()),
        )
        assertEquals(listOf("recent"), filteredRecordings(recordings, null, 1, "").map { it.id })
        assertEquals(listOf("recent", "old"), filteredRecordings(recordings, null, null, "").map { it.id })
    }

    @Test
    fun filteredRecordingsSearchesCameraAndDeviceNameCaseInsensitively() {
        val recordings = listOf(
            recording("front", cameraName = "Front door", deviceName = "Kitchen Pixel"),
            recording("garage", cameraName = "Driveway", deviceName = "Garage Tablet"),
        )
        assertEquals(listOf("front"), filteredRecordings(recordings, null, null, "front").map { it.id })
        assertEquals(listOf("garage"), filteredRecordings(recordings, null, null, "GARAGE").map { it.id })
    }

    @Test
    fun filteredRecordingsSortsNewestFirst() {
        val recordings = listOf(
            recording("old", createdAt = "2026-09-25T12:00:00Z"),
            recording("new", createdAt = "2026-09-27T12:00:00Z"),
        )
        assertEquals(listOf("new", "old"), filteredRecordings(recordings, null, null, "").map { it.id })
    }

    @Test
    fun groupRecordingsByDayGroupsConsecutiveSameDayEntries() {
        val recordings = listOf(
            recording("a", createdAt = "2026-09-27T08:00:00Z"),
            recording("b", createdAt = "2026-09-27T09:00:00Z"),
            recording("c", createdAt = "2026-09-25T09:00:00Z"),
        )
        val groups = groupRecordingsByDay(recordings)
        assertEquals(2, groups.size)
        assertEquals(listOf("a", "b"), groups[0].second.map { it.id })
        assertEquals(listOf("c"), groups[1].second.map { it.id })
    }
}
