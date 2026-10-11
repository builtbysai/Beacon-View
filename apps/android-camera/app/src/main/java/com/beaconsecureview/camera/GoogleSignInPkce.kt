package com.beaconsecureview.camera

import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * PKCE (RFC 7636, S256) for the Google sign-in that returns through the
 * `beaconsecureview://auth/mobile` link. Any app on the phone can claim that
 * custom scheme and read the code in it, so the code is bound to a challenge
 * and is useless without the verifier, which never leaves this app (V1).
 */
internal fun pkceChallengeFor(verifier: String): String =
    Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

internal fun newPkceVerifier(random: SecureRandom = SecureRandom()): String {
    val bytes = ByteArray(32)
    random.nextBytes(bytes)
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}

/** Keeps the verifier across the trip to the browser, which can outlast the process. */
internal class GoogleSignInPkce(context: Context) {
    private val preferences = context.getSharedPreferences("beacon_google_pkce", Context.MODE_PRIVATE)

    /** Starts a sign-in and returns the challenge to send; replaces any earlier attempt. */
    fun begin(): String {
        val verifier = newPkceVerifier()
        preferences.edit().putString("verifier", verifier).apply()
        return pkceChallengeFor(verifier)
    }

    /** The verifier for the sign-in that just returned, handed over once. */
    fun take(): String? {
        val verifier = preferences.getString("verifier", null)
        preferences.edit().remove("verifier").apply()
        return verifier
    }
}
