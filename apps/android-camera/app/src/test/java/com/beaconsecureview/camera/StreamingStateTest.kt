package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals

class StreamingStateTest {
    @Test
    fun connectedPeerIsStreaming() {
        assertEquals(StreamingState.Streaming, stateAfterPeerConnection(connected = true))
    }

    @Test
    fun disconnectedPeerIsNotStreaming() {
        assertEquals(StreamingState.Disconnected, stateAfterPeerConnection(connected = false))
    }
}
