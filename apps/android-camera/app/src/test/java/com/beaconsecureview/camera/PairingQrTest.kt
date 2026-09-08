package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PairingQrTest {
    @Test
    fun acceptsBeaconQrAndManualCodes() {
        assertEquals("ABCD234567", parsePairingQr("beacon://pair?code=ABCD234567"))
        assertEquals("ABCD234567", parsePairingQr("abcd234567"))
        assertEquals(
            "ABCD234567",
            parsePairingQr(
                "https://beaconapp.duckdns.org/pair?code=ABCD234567",
                "https://beaconapp.duckdns.org",
            ),
        )
    }

    @Test
    fun rejectsForeignOrMalformedCodes() {
        assertNull(parsePairingQr("https://example.com/?code=ABCD234567"))
        assertNull(
            parsePairingQr(
                "https://example.com/pair?code=ABCD234567",
                "https://beaconapp.duckdns.org",
            ),
        )
        assertNull(parsePairingQr("beacon://pair?code=too-short"))
        assertNull(parsePairingQr(null))
    }

    @Test
    fun acceptsOnlyTrustedGoogleMobileReturnLinks() {
        val code = "A".repeat(40)
        assertEquals(
            code,
            parseMobileGoogleAuthLink(
                "https://beaconapp.duckdns.org/auth/mobile#code=$code",
                "https://beaconapp.duckdns.org",
            ),
        )
        assertNull(
            parseMobileGoogleAuthLink(
                "https://example.com/auth/mobile#code=$code",
                "https://beaconapp.duckdns.org",
            ),
        )
    }
}
