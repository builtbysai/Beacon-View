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
