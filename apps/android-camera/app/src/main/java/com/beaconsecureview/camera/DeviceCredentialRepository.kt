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
