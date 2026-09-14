package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PairingQrTest {
    @Test
    fun acceptsBeaconQrAndManualCodes() {
        assertEquals("ABCD234567", parsePairingQr("beacon://pair?code=ABCD234567"))
        assertEquals("ABCD234567", parsePairingQr("abcd234567"))
        assertEquals(
            "ABCD234567",
            parsePairingQr(
                "https://beacon.builtbysai.com/pair?code=ABCD234567",
                "https://beacon.builtbysai.com",
            ),
        )
    }

    @Test
    fun rejectsForeignOrMalformedCodes() {
        assertNull(parsePairingQr("https://example.com/?code=ABCD234567"))
        assertNull(
            parsePairingQr(
                "https://example.com/pair?code=ABCD234567",
                "https://beacon.builtbysai.com",
            ),
        )
        assertNull(parsePairingQr("beacon://pair?code=too-short"))
        assertNull(parsePairingQr(null))
    }

    @Test
    fun validatesAndNormalizesManualCodesBeforePairing() {
        assertEquals("ABCD234567", normalizePairingCodeInput(" abcd-234567 "))
        assertTrue(isValidPairingCode("ABCD234567"))
        assertFalse(isValidPairingCode("INVALID"))
        assertFalse(isValidPairingCode("ABCD23456O"))
    }

    @Test
    fun acceptsOnlyTrustedGoogleMobileReturnLinks() {
        val code = "A".repeat(40)
        assertEquals(
            code,
            parseMobileGoogleAuthLink(
                "https://beacon.builtbysai.com/auth/mobile#code=$code",
                "https://beacon.builtbysai.com",
            ),
        )
        assertEquals(
            code,
            parseMobileGoogleAuthLink(
                "beaconsecureview://auth/mobile?code=$code",
                "https://beacon.builtbysai.com",
            ),
        )
        assertNull(
            parseMobileGoogleAuthLink(
                "https://example.com/auth/mobile#code=$code",
                "https://beacon.builtbysai.com",
            ),
        )
        assertNull(
            parseMobileGoogleAuthLink(
                "beaconsecureview://other/mobile?code=$code",
                "https://beacon.builtbysai.com",
            ),
        )
    }
}
