package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LaunchLinksTest {
    @Test
    fun aLauncherShortcutOpensOnlyThePagesItNames() {
        assertEquals("https://beacon.example/cameras", LaunchLinks.pageUrl("https://beacon.example/", "cameras"))
        assertEquals("https://beacon.example/activity", LaunchLinks.pageUrl("https://beacon.example", "activity"))
        assertNull(LaunchLinks.pageUrl("https://beacon.example", "settings"))
        assertNull(LaunchLinks.pageUrl("https://beacon.example", "//evil.example"))
        assertNull(LaunchLinks.pageUrl("https://beacon.example", null))
    }

    @Test
    fun anAlertLinkNeedsARealEventId() {
        val id = "123e4567-e89b-12d3-a456-426614174000"
        assertEquals("https://beacon.example/activity?alert=$id", LaunchLinks.alertUrl("https://beacon.example", id))
        assertNull(LaunchLinks.alertUrl("https://beacon.example", "../admin"))
    }
}
