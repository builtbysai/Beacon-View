package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MotionSettingsParseTest {
    private fun camera(vararg extra: String): String =
        """{"cameras":[{"cameraId":"cam-1","enabled":true,${extra.joinToString(",")}${if (extra.isEmpty()) "" else ","}"sensitivity":"medium","cooldownSeconds":60}]}"""

    @Test
    fun readsAValidResponse() {
        val settings = parseMotionSettingsResponse(
            camera("\"quietHours\":{\"start\":\"22:00\",\"end\":\"07:00\",\"timeZone\":\"America/New_York\"}"),
        )["cam-1"]!!
        assertTrue(settings.enabled)
        assertEquals(60, settings.cooldownSeconds)
        assertEquals("America/New_York", settings.quietHours?.timeZone)
    }

    @Test
    fun anUnknownTimeZoneDropsOnlyQuietHoursAndKeepsMotionOn() {
        val settings = parseMotionSettingsResponse(
            camera("\"quietHours\":{\"start\":\"22:00\",\"end\":\"07:00\",\"timeZone\":\"Mars/Olympus_Mons\"}"),
        )["cam-1"]!!
        assertTrue(settings.enabled)
        assertNull(settings.quietHours)
        assertEquals(60, settings.cooldownSeconds)
    }

    @Test
    fun anUnknownSensitivityOrCooldownFallsBackInsteadOfFailing() {
        val body =
            """{"cameras":[{"cameraId":"cam-1","enabled":true,"sensitivity":"extreme","cooldownSeconds":45}]}"""
        val settings = parseMotionSettingsResponse(body)["cam-1"]!!
        assertTrue(settings.enabled)
        assertEquals(MotionSensitivity.Medium, settings.sensitivity)
        assertEquals(30, settings.cooldownSeconds)
    }
}
