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
        // ADR 0067's direct browser setup link carries the same bearer code and must be
        // accepted too -- a household member scanning it with the Android app should not
        // be told it "is not a Beacon setup link" just because a browser normally opens it.
        assertEquals(
            "ABCD234567",
            parsePairingQr(
                "https://beacon.builtbysai.com/camera-mode/setup?code=ABCD234567",
                "https://beacon.builtbysai.com",
            ),
        )
        assertEquals(
            "ABCD234567",
            parsePairingQr(
                "http://10.0.2.2:5173/pair?code=ABCD234567",
                "http://10.0.2.2:3000",
                "http://10.0.2.2:5173",
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
        assertNull(parsePairingQr("http://10.0.2.2:9999/pair?code=ABCD234567", "http://10.0.2.2:3000", "http://10.0.2.2:5173"))
        assertNull(parsePairingQr(null))
        assertNull(
            parsePairingQr(
                "https://beacon.builtbysai.com/not-a-setup-path?code=ABCD234567",
                "https://beacon.builtbysai.com",
            ),
        )
    }

    @Test
    fun validatesAndNormalizesManualCodesBeforePairing() {
        assertEquals("ABCD234567", normalizePairingCodeInput(" abcd-234567 "))
        assertTrue(isValidPairingCode("ABCD234567"))
        assertFalse(isValidPairingCode("INVALID"))
        assertFalse(isValidPairingCode("ABCD23456O"))
    }

}
