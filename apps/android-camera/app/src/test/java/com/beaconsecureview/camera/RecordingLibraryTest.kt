package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RecordingLibraryTest {
    @Test
    fun formatsDurationAndKnownStatuses() {
        assertNull(formatRecordingDuration(null))
        assertEquals("1:05", formatRecordingDuration(65_000))
        assertEquals("Uploading securely", recordingStatusLabel("uploading"))
        assertEquals("Unavailable", recordingStatusLabel("unexpected"))
    }
}
