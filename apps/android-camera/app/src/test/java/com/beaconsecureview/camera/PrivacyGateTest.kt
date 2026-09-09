package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith

class PrivacyGateTest {
    @Test
    fun staleStartupSnapshotCannotUndoALocalPause() {
        val gate = PrivacyGate()
        val snapshotVersion = gate.version
        val pause = assertNotNull(gate.begin(true))
        gate.complete(pause, true)
        assertFalse(gate.receiveSnapshot(false, snapshotVersion))
        assertTrue(gate.privacyEnabled)
        assertTrue(gate.receiveSnapshot(true, gate.version))
    }
    @Test
    fun lateMotionReportsDuringPrivacyDoNotInvalidatePairing() {
        listOf(201, 204, 409).forEach(::checkMotionReportResponse)
        assertFailsWith<AuthorizationLostException> { checkMotionReportResponse(401) }
        assertFailsWith<AuthorizationLostException> { checkMotionReportResponse(403) }
        assertFailsWith<IllegalStateException> { checkMotionReportResponse(503) }
    }
    @Test
    fun failedPauseKeepsCaptureBlockedThroughStaleRemoteStateAndRestart() {
        val gate = PrivacyGate()
        val request = assertNotNull(gate.begin(true))
        assertTrue(gate.privacyEnabled)
        gate.receiveRemote(false)
        gate.fail(request)
        assertTrue(gate.pendingPause)
        assertTrue(gate.privacyEnabled)
        val restarted = PrivacyGate(gate.pendingPause)
        restarted.receiveRemote(false)
        assertTrue(restarted.privacyEnabled)
        restarted.receiveRemote(true)
        assertFalse(restarted.pendingPause)
        assertTrue(restarted.privacyEnabled)
    }

    @Test
    fun failedResumeKeepsCaptureBlockedUntilAnExplicitRetrySucceeds() {
        val gate = PrivacyGate(persistedPause = true)
        val failed = assertNotNull(gate.begin(false))
        gate.fail(failed)
        assertTrue(gate.privacyEnabled)
        val retry = assertNotNull(gate.begin(false))
        gate.complete(retry, false)
        assertFalse(gate.pendingPause)
        assertFalse(gate.privacyEnabled)
    }

    @Test
    fun staleResponseCannotResumeAfterANewerRemotePause() {
        val gate = PrivacyGate()
        gate.receiveRemote(true)
        val resume = assertNotNull(gate.begin(false))
        gate.receiveRemote(false)
        gate.receiveRemote(true)
        gate.complete(resume, false)
        assertTrue(gate.privacyEnabled)
    }

    @Test
    fun confirmedPauseClearsOnlyPendingIntentAndKeepsPrivacyOn() {
        val gate = PrivacyGate()
        val pause = assertNotNull(gate.begin(true))
        assertNull(gate.begin(false))
        gate.complete(pause, true)
        assertFalse(gate.pendingPause)
        assertTrue(gate.privacyEnabled)
        assertFalse(gate.requestInFlight)
        val resume = assertNotNull(gate.begin(false))
        assertFalse(gate.complete(pause, false))
        gate.complete(resume, false)
        assertFalse(gate.privacyEnabled)
    }

    @Test
    fun conflictingRemoteStateKeepsAnUnconfirmedPauseBlocked() {
        val gate = PrivacyGate()
        val request = assertNotNull(gate.begin(true))
        gate.receiveRemote(false)
        gate.complete(request, true)
        assertTrue(gate.pendingPause)
        assertTrue(gate.privacyEnabled)
    }
}
