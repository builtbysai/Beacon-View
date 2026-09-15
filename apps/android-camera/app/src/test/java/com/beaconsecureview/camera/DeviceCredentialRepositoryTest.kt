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
