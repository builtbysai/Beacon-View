package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GoogleSignInPkceTest {
    @Test
    fun challengeMatchesTheRfc7636Example() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            pkceChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
    }

    @Test
    fun newVerifiersAreLongEnoughAndDifferent() {
        val first = newPkceVerifier()
        val second = newPkceVerifier()
        assertTrue(first.length in 43..128)
        assertTrue(Regex("^[A-Za-z0-9._~-]+$").matches(first))
        assertTrue(first != second)
        assertEquals(43, pkceChallengeFor(first).length)
    }
}
