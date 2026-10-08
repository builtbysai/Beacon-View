package com.beaconsecureview.camera

import java.net.SocketTimeoutException
import java.security.cert.CertPathValidatorException
import javax.net.ssl.SSLHandshakeException
import kotlin.test.Test
import kotlin.test.assertEquals

class UserFacingErrorsTest {
    @Test
    fun certificateFailureExplainsNetworkSignIn() {
        val error =
            SSLHandshakeException("certificate failure").apply {
                initCause(CertPathValidatorException("Trust anchor for certification path not found"))
            }

        assertEquals(
            "This network may need sign-in or is blocking secure connections. Open Android Wi-Fi settings, sign in, or switch networks.",
            error.userFacingMessage("Sign in failed"),
        )
    }

    @Test
    fun temporaryNetworkFailureHasActionableMessage() {
        assertEquals(
            "Beacon cannot reach the service. Check your internet connection and try again.",
            SocketTimeoutException("timed out").userFacingMessage("Sign in failed"),
        )
    }

    @Test
    fun applicationErrorsKeepTheirCuratedMessage() {
        assertEquals(
            "Email or password is incorrect",
            IllegalStateException("Email or password is incorrect").userFacingMessage("Sign in failed"),
        )
    }

    @Test
    fun unexpectedErrorsDoNotExposeInternalDetails() {
        assertEquals(
            "Sign in failed",
            RuntimeException("internal implementation detail").userFacingMessage("Sign in failed"),
        )
    }
}
