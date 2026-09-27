package com.beaconsecureview.camera

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MonitorAuthScreenTest {
    @Test
    fun `registration requires an email and twelve character password`() {
        assertFalse(registrationReady("", "correct horse battery staple", "correct horse battery staple"))
        assertFalse(registrationReady("owner@example.com", "short", "short"))
    }

    @Test
    fun `registration requires matching passwords`() {
        assertFalse(registrationReady("owner@example.com", "correct horse battery staple", "different password"))
        assertTrue(registrationReady("owner@example.com", "correct horse battery staple", "correct horse battery staple"))
    }
}
