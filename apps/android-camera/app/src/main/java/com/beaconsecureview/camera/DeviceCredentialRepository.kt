package com.beaconsecureview.camera

interface DeviceCredentialRepository {
    fun save(credential: String)

    fun read(): String?

    fun clear()
}

fun retainCredentialAfterHeartbeat(
    repository: DeviceCredentialRepository,
    accepted: Boolean,
): Boolean {
    if (!accepted) repository.clear()
    return accepted
}

fun beginLocalDisconnect(
    repository: DeviceCredentialRepository,
    stopCapture: () -> Unit,
) {
    // Clear first so a sticky foreground service cannot restart with the old
    // credential while Android is still finishing the stop request.
    repository.clear()
    stopCapture()
}

/**
 * Decides when the phone may forget its pairing. A single rejection can come
 * from a proxy, a captive network or a server fault, and forgetting means the
 * owner must pair again by hand, so the credential is cleared only after
 * several rejections over at least [minimumSpanMs] with no acceptance between
 * them (V40). A device the owner really removed is still cleared, a minute or
 * two later.
 */
class RejectedCredentialTracker(
    private val strikes: Int = 3,
    private val minimumSpanMs: Long = 60_000,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private var count = 0
    private var firstAt = 0L

    fun accept() {
        count = 0
    }

    /** Records a rejection; true once the credential should be forgotten. */
    fun reject(): Boolean {
        val now = clock()
        if (count == 0) firstAt = now
        count += 1
        return count >= strikes && now - firstAt >= minimumSpanMs
    }
}
