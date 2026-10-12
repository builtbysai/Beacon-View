package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AppUpdateTest {
    @Test
    fun comparesVersionsTheWayPeopleReadThem() {
        assertTrue(isNewerVersion("0.1.0-alpha10", "0.1.0-alpha9"))
        assertFalse(isNewerVersion("0.1.0-alpha9", "0.1.0-alpha10"))
        assertFalse(isNewerVersion("0.1.0-alpha10", "0.1.0-alpha10"))
        assertTrue(isNewerVersion("0.1.1-alpha1", "0.1.0-alpha12"))
        assertTrue(isNewerVersion("0.2.0", "0.1.9"))
        // A release beats its own alphas, and an alpha does not beat the release.
        assertTrue(isNewerVersion("0.1.0", "0.1.0-alpha12"))
        assertFalse(isNewerVersion("0.1.0-alpha12", "0.1.0"))
    }

    @Test
    fun readsTheAndroidAppOutOfTheDownloadsManifest() {
        val json =
            """{"files":[
              {"platform":"windows","file":"Beacon-Setup-0.4.1-x64.exe"},
              {"platform":"android","file":"Beacon-android-0.1.0-alpha10.apk"}],"version":"0.4.1"}"""
        assertEquals(AvailableUpdate("0.1.0-alpha10", "Beacon-android-0.1.0-alpha10.apk"), parseAndroidUpdate(json))
        assertNull(parseAndroidUpdate("""{"files":[{"platform":"windows","file":"Beacon-Setup-0.4.1-x64.exe"}]}"""))
        assertNull(parseAndroidUpdate("""{"files":[{"platform":"android","file":"../../evil.apk"}]}"""))
    }
}
