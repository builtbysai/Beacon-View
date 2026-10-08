package com.beaconsecureview.camera

import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertPathValidatorException
import javax.net.ssl.SSLHandshakeException

private const val SECURE_CONNECTION_MESSAGE =
    "This network may need sign-in or is blocking secure connections. Open Android Wi-Fi settings, sign in, or switch networks."

private const val NETWORK_UNAVAILABLE_MESSAGE =
    "Beacon cannot reach the service. Check your internet connection and try again."

internal fun Throwable.userFacingMessage(fallback: String): String {
    val causes = generateSequence(this) { it.cause }.take(16).toList()

    if (causes.any { it is CertPathValidatorException || it is SSLHandshakeException }) {
        return SECURE_CONNECTION_MESSAGE
    }

    if (
        causes.any {
            it is UnknownHostException ||
                it is ConnectException ||
                it is SocketTimeoutException
        }
    ) {
        return NETWORK_UNAVAILABLE_MESSAGE
    }

    return (this as? IllegalStateException)?.message?.takeIf(String::isNotBlank) ?: fallback
}
