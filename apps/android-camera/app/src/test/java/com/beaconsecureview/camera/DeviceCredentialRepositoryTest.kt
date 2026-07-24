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
