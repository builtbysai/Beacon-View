package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

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
}
