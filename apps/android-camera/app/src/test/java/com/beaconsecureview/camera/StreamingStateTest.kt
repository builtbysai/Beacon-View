package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals

class StreamingStateTest {
    @Test
    fun connectedPeerIsStreaming() {
        assertEquals(StreamingState.Connected, stateAfterPeerConnection(connected = true))
    }

    @Test
    fun disconnectedPeerIsNotStreaming() {
        assertEquals(StreamingState.Reconnecting, stateAfterPeerConnection(connected = false))
    }

    @Test
    fun cameraLifecycleIsIndependentFromViewerLifecycle() {
        assertEquals(
            DeviceLifecycle.Idle,
            deviceStateFor(signalingOnline = true, activeViewers = 0, enabled = true),
        )
        assertEquals(
            DeviceLifecycle.Streaming,
            deviceStateFor(signalingOnline = true, activeViewers = 3, enabled = true),
        )
        assertEquals(
            DeviceLifecycle.Idle,
            deviceStateFor(signalingOnline = true, activeViewers = 0, enabled = true),
        )
    }

    @Test
    fun networkLossDoesNotRequirePairingAgain() {
        assertEquals(
            DeviceLifecycle.Offline,
            deviceStateFor(signalingOnline = false, activeViewers = 0, enabled = true),
        )
        assertEquals(
            DeviceLifecycle.Idle,
            deviceStateFor(signalingOnline = true, activeViewers = 0, enabled = true),
        )
    }

    @Test
    fun disabledDeviceHasAnExplicitLifecycle() {
        assertEquals(
            DeviceLifecycle.Disabled,
            deviceStateFor(signalingOnline = true, activeViewers = 2, enabled = false),
        )
    }

    @Test
    fun sourceSwitchingIsDistinctFromFailure() {
        val runtime = CameraRuntimeState(sourceLifecycle = CameraSourceLifecycle.Switching)
        assertEquals(CameraSourceLifecycle.Switching, runtime.sourceLifecycle)
    }
}
