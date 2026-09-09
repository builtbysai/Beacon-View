package com.beaconsecureview.camera

/** Local pause intent takes precedence until the server confirms it or Resume succeeds. */
internal class PrivacyGate(persistedPause: Boolean = false) {
    data class Request(val sequence: Long, val enabled: Boolean, val remoteRevision: Long)

    var pendingPause = persistedPause
        private set
    private var serverPrivacy = false
    private var remoteRevision = 0L
    private var sequence = 0L
    private var currentRequest: Request? = null
    var version = 0L
        private set

    val privacyEnabled: Boolean get() = pendingPause || serverPrivacy
    val requestInFlight: Boolean get() = currentRequest != null

    fun begin(enabled: Boolean): Request? {
        if (requestInFlight) return null
        version += 1
        if (enabled) pendingPause = true
        return Request(++sequence, enabled, remoteRevision).also { currentRequest = it }
    }

    fun receiveRemote(enabled: Boolean) {
        version += 1
        remoteRevision += 1
        serverPrivacy = enabled
        if (enabled) pendingPause = false
    }

    fun receiveSnapshot(enabled: Boolean, requestedAtVersion: Long): Boolean {
        if (version != requestedAtVersion) return false
        receiveRemote(enabled)
        return true
    }

    fun complete(request: Request, enabled: Boolean): Boolean {
        if (request != currentRequest) return false
        version += 1
        // An HTTP response must not replace a newer signaling observation.
        if (request.remoteRevision == remoteRevision) serverPrivacy = enabled
        if ((serverPrivacy && enabled) || (!request.enabled && !serverPrivacy && !enabled)) {
            pendingPause = false
        }
        currentRequest = null
        return true
    }

    fun fail(request: Request): Boolean {
        if (request != currentRequest) return false
        version += 1
        currentRequest = null
        return true
    }
}
