package com.beaconsecureview.camera

import org.junit.Assert.assertEquals
import org.junit.Test

class ManualRecordingTest {
    @Test
    fun `manual recording labels expose capture and upload state`() {
        assertEquals("Starting recording…", manualRecordingLabel(true, null, 0))
        assertEquals("Record a 15-second clip", manualRecordingLabel(false, null, 0))
        assertEquals("Recording · Manual · 07s / 15s", manualRecordingLabel(false, recording("requested"), 7))
        assertEquals("Recording · Manual · 15s / 15s", manualRecordingLabel(false, recording("recording"), 19))
        assertEquals(
            "Encrypting and uploading recording",
            manualRecordingLabel(false, recording("uploading"), 15),
        )
        assertEquals("Recording saved", manualRecordingLabel(false, recording("available"), 15))
        assertEquals("Recording failed", manualRecordingLabel(false, recording("failed"), 3))
    }

    private fun recording(status: String) =
        BeaconApi.RecordingSummary(
            id = "recording-one",
            cameraId = "camera-one",
            cameraName = "Rear camera",
            deviceName = "Entry",
            status = status,
            durationMs = null,
            createdAt = "2026-09-27T12:00:00Z",
            triggerMotionEventId = null,
            hasThumbnail = false,
        )
}
