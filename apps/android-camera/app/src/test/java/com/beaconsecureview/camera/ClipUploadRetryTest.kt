package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.coroutines.runBlocking

class ClipUploadRetryTest {
    @Test
    fun succeedsAfterATransientFailure() = runBlocking {
        var calls = 0
        val waits = mutableListOf<Long>()
        val result =
            retryTransient(sleep = { waits += it }) {
                calls += 1
                if (calls < 3) throw IllegalStateException("connection reset")
                "file-id"
            }
        assertEquals("file-id", result)
        assertEquals(3, calls)
        assertEquals(listOf(5_000L, 20_000L), waits)
    }

    @Test
    fun givesUpAfterTheLastAttemptWithTheLastError() = runBlocking {
        var calls = 0
        val error =
            assertFailsWith<IllegalStateException> {
                retryTransient(sleep = {}) {
                    calls += 1
                    throw IllegalStateException("attempt $calls")
                }
            }
        assertEquals(3, calls)
        assertEquals("attempt 3", error.message)
    }

    @Test
    fun doesNotRetryLostAuthorization() = runBlocking {
        var calls = 0
        assertFailsWith<AuthorizationLostException> {
            retryTransient(sleep = {}) {
                calls += 1
                throw AuthorizationLostException()
            }
        }
        assertEquals(1, calls)
    }
}
