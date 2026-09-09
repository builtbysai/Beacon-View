package com.beaconsecureview.camera

const val MAX_SIGNALING_RETRIES = 5
const val STABLE_CONNECTION_MILLIS = 10_000L

class RetryGate {
    private var scheduled = false

    fun schedule(): Boolean {
        if (scheduled) return false
        scheduled = true
        return true
    }

    fun clear() {
        scheduled = false
    }
}

fun retryDelayMillis(
    attempt: Int,
    jitter: Double,
): Long {
    val exponential = (1_000L shl attempt.coerceIn(0, 4)).coerceAtMost(16_000L)
    val factor = 0.75 + jitter.coerceIn(0.0, 1.0) * 0.5
    return (exponential * factor).toLong()
}

class RetryGeneration {
    private var value = 0

    fun next(): Int = ++value

    fun isCurrent(generation: Int): Boolean = generation == value

    fun cancel() {
        value += 1
    }
}
