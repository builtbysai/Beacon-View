package com.beaconsecureview.camera

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * Runs [block], trying again after a short wait when it fails. A motion clip is
 * the evidence the camera exists to keep, and one dropped connection or server
 * restart used to discard it (V59). Lost authorization is not retried, and
 * cancellation always passes through.
 */
internal suspend fun <T> retryTransient(
    attempts: Int = 3,
    delaysMs: List<Long> = listOf(5_000, 20_000),
    sleep: suspend (Long) -> Unit = { delay(it) },
    block: suspend () -> T,
): T {
    var lastError: Throwable? = null
    for (attempt in 0 until attempts) {
        try {
            return block()
        } catch (error: CancellationException) {
            throw error
        } catch (error: AuthorizationLostException) {
            throw error
        } catch (error: Throwable) {
            lastError = error
            if (attempt < attempts - 1) sleep(delaysMs.getOrElse(attempt) { delaysMs.last() })
        }
    }
    throw lastError ?: IllegalStateException("No attempts were made")
}
