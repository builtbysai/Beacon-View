package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ReconnectPolicyTest {
    @Test
    fun retryDelayUsesBoundedExponentialBackoff() {
        assertEquals(1_000, retryDelayMillis(0, 0.5))
        assertEquals(16_000, retryDelayMillis(4, 0.5))
        assertEquals(20_000, retryDelayMillis(50, 1.0))
    }

    @Test
    fun newGenerationInvalidatesStaleWork() {
        val generations = RetryGeneration()
        val first = generations.next()
        val second = generations.next()
        assertFalse(generations.isCurrent(first))
        assertTrue(generations.isCurrent(second))
        generations.cancel()
        assertFalse(generations.isCurrent(second))
    }
}
