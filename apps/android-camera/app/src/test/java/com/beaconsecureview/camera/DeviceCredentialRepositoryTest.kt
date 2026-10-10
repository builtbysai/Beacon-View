package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DeviceCredentialRepositoryTest {
    @Test
    fun revokedCredentialIsClearedImmediately() {
        val repository = MemoryCredentialRepository("secret")

        assertFalse(retainCredentialAfterHeartbeat(repository, accepted = false))
        assertNull(repository.read())
    }

    @Test
    fun acceptedCredentialIsRetained() {
        val repository = MemoryCredentialRepository("secret")

        assertTrue(retainCredentialAfterHeartbeat(repository, accepted = true))
        assertTrue(repository.read() == "secret")
    }

    @Test
    fun aBriefRunOfRejectionsDoesNotForgetThePairing() {
        var now = 0L
        val tracker = RejectedCredentialTracker(strikes = 3, minimumSpanMs = 60_000) { now }

        assertFalse(tracker.reject())
        now += 2_000
        assertFalse(tracker.reject())
        now += 2_000
        // Three rejections, but only four seconds apart: a network blip, not a removal.
        assertFalse(tracker.reject())
    }

    @Test
    fun rejectionsSpreadOverAMinuteForgetThePairing() {
        var now = 0L
        val tracker = RejectedCredentialTracker(strikes = 3, minimumSpanMs = 60_000) { now }

        assertFalse(tracker.reject())
        now += 30_000
        assertFalse(tracker.reject())
        now += 31_000
        assertTrue(tracker.reject())
    }

    @Test
    fun anAcceptedCheckStartsTheCountAgain() {
        var now = 0L
        val tracker = RejectedCredentialTracker(strikes = 3, minimumSpanMs = 60_000) { now }

        tracker.reject()
        now += 40_000
        tracker.reject()
        tracker.accept()
        now += 40_000
        assertFalse(tracker.reject())
        now += 40_000
        assertFalse(tracker.reject())
    }

    @Test
    fun disconnectClearsCredentialBeforeStoppingCapture() {
        val repository = MemoryCredentialRepository("secret")
        var credentialWhenCaptureStopped: String? = "not-called"

        beginLocalDisconnect(repository) {
            credentialWhenCaptureStopped = repository.read()
        }

        assertNull(credentialWhenCaptureStopped)
        assertNull(repository.read())
    }
}

private class MemoryCredentialRepository(initial: String?) : DeviceCredentialRepository {
    private var credential = initial

    override fun save(credential: String) {
        this.credential = credential
    }

    override fun read(): String? = credential

    override fun clear() {
        credential = null
    }
}
