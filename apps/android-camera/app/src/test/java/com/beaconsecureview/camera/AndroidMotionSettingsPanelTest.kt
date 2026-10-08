package com.beaconsecureview.camera

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidMotionSettingsPanelTest {
    @Test
    fun `cooldown labels match the PWA choices`() {
        assertEquals("30 seconds", motionCooldownLabel(30))
        assertEquals("1 minute", motionCooldownLabel(60))
        assertEquals("2 minutes", motionCooldownLabel(120))
        assertEquals("5 minutes", motionCooldownLabel(300))
    }
}
