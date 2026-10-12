package com.beaconsecureview.camera

import android.webkit.PermissionRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WebShellPolicyTest {
    private val app = "https://beacon.builtbysai.com"

    @Test
    fun onlyTheAppsOwnOriginLoadsInsideTheView() {
        assertTrue(WebShellPolicy.isAppUrl("https://beacon.builtbysai.com/cameras/1", app))
        assertTrue(WebShellPolicy.isAppUrl("https://BEACON.builtbysai.com:443/", app))
        assertFalse(WebShellPolicy.isAppUrl("https://beacon.builtbysai.com.evil.example/", app))
        assertFalse(WebShellPolicy.isAppUrl("https://evil.example/https://beacon.builtbysai.com/", app))
        assertFalse(WebShellPolicy.isAppUrl("http://beacon.builtbysai.com/", app))
        assertFalse(WebShellPolicy.isAppUrl("https://beacon.builtbysai.com:8443/", app))
        assertFalse(WebShellPolicy.isAppUrl("https://user:pw@beacon.builtbysai.com/", app))
        assertFalse(WebShellPolicy.isAppUrl("javascript:alert(1)", app))
        assertFalse(WebShellPolicy.isAppUrl("file:///sdcard/x.html", app))
        assertFalse(WebShellPolicy.isAppUrl(null, app))
    }

    @Test
    fun originsIgnoreDefaultPortsAndCase() {
        assertEquals("https://beacon.builtbysai.com", WebShellPolicy.originOf("HTTPS://Beacon.BuiltBySai.com:443/x?y"))
        assertEquals("http://10.0.2.2:5173", WebShellPolicy.originOf("http://10.0.2.2:5173/"))
        assertNull(WebShellPolicy.originOf("ftp://example.com"))
    }

    @Test
    fun grantsOnlyTheResourceAskedForAndAllowedAndOnlyToTheApp() {
        val both = arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE, PermissionRequest.RESOURCE_AUDIO_CAPTURE)
        assertEquals(
            listOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE),
            WebShellPolicy.resourcesToGrant(both, "https://beacon.builtbysai.com/", app, cameraAllowed = false, microphoneAllowed = true),
        )
        assertEquals(
            both.toList(),
            WebShellPolicy.resourcesToGrant(both, "https://beacon.builtbysai.com/", app, cameraAllowed = true, microphoneAllowed = true),
        )
        assertTrue(WebShellPolicy.resourcesToGrant(both, "https://evil.example/", app, true, true).isEmpty())
        assertTrue(
            WebShellPolicy.resourcesToGrant(arrayOf("android.webkit.resource.PROTECTED_MEDIA_ID"), app, app, true, true).isEmpty(),
        )
    }
}
