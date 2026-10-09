package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ThermalStatusTest {
    @Test
    fun mapsEveryAndroidStatusToTheWireValue() {
        assertEquals(
            listOf("none", "light", "moderate", "severe", "critical", "emergency", "shutdown"),
            (0..6).map { ThermalStatus.wireValue(it) },
        )
    }

    @Test
    fun sendsNothingForAStatusItDoesNotKnow() {
        assertNull(ThermalStatus.wireValue(-1))
        assertNull(ThermalStatus.wireValue(7))
    }

    @Test
    fun sendsNothingWithoutAPowerManager() {
        assertNull(ThermalStatus.current(null))
    }
}
