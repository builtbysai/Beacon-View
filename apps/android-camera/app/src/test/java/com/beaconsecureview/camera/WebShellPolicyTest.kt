package com.beaconsecureview.camera

import android.webkit.PermissionRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
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

class WebShellNavigationTest {
    private val app = "https://beacon.builtbysai.com"

    @Test
    fun googleAndOutsideLinksNeverLoadInsideTheView() {
        assertEquals(WebShellPolicy.Navigation.Load, WebShellPolicy.classify("$app/cameras", app))
        assertEquals(WebShellPolicy.Navigation.GoogleSignIn(false), WebShellPolicy.classify("$app/api/auth/google", app))
        assertEquals(
            WebShellPolicy.Navigation.GoogleSignIn(true),
            WebShellPolicy.classify("$app/api/auth/google?intent=addPassword", app),
        )
        assertEquals(
            WebShellPolicy.Navigation.GoogleInBrowser("/settings?section=storage"),
            WebShellPolicy.classify("$app/api/drive/connect?purpose=recordings", app),
        )
        assertEquals(
            WebShellPolicy.Navigation.GoogleInBrowser("/settings?section=account"),
            WebShellPolicy.classify("$app/api/auth/google/link", app),
        )
        assertEquals(
            WebShellPolicy.Navigation.External("https://accounts.google.com/o/oauth2/v2/auth"),
            WebShellPolicy.classify("https://accounts.google.com/o/oauth2/v2/auth", app),
        )
        assertEquals(WebShellPolicy.Navigation.External("mailto:a@b.test"), WebShellPolicy.classify("mailto:a@b.test", app))
        assertEquals(WebShellPolicy.Navigation.Blocked, WebShellPolicy.classify("intent://x#Intent;end", app))
        assertEquals(WebShellPolicy.Navigation.Blocked, WebShellPolicy.classify("javascript:alert(1)", app))
        assertEquals(WebShellPolicy.Navigation.Blocked, WebShellPolicy.classify(null, app))
    }

    @Test
    fun theGoogleStartUrlCarriesTheChallengeForTheDesktopStyleHandoff() {
        val challenge = "A".repeat(43)
        assertEquals(
            "$app/api/auth/google?platform=desktop&challenge=$challenge",
            WebShellPolicy.googleStartUrl(app, challenge, addPassword = false),
        )
        assertTrue(WebShellPolicy.googleStartUrl(app, challenge, addPassword = true).endsWith("&intent=addPassword"))
    }

    @Test
    fun onlyAWellFormedReturnLinkIsAccepted() {
        val code = "c".repeat(40)
        assertEquals(
            WebShellPolicy.GoogleReturn.Code(code),
            WebShellPolicy.parseGoogleReturn("beaconsecureview://auth/desktop?code=$code"),
        )
        assertEquals(WebShellPolicy.GoogleReturn.Failed, WebShellPolicy.parseGoogleReturn("beaconsecureview://auth/desktop?status=failed"))
        assertNull(WebShellPolicy.parseGoogleReturn("beaconsecureview://auth/desktop?code=short"))
        assertNull(WebShellPolicy.parseGoogleReturn("beaconsecureview://auth/mobile?code=$code"))
        assertNull(WebShellPolicy.parseGoogleReturn("https://beacon.builtbysai.com/auth/desktop?code=$code"))
        assertNull(WebShellPolicy.parseGoogleReturn("beaconsecureview://evil/desktop?code=$code"))
        assertNull(WebShellPolicy.parseGoogleReturn(null))
    }

    @Test
    fun theExchangeScriptEncodesItsInputsAndRefusesBadOnes() {
        val verifier = "v".repeat(43)
        val script = WebShellPolicy.exchangeScript("c".repeat(40), verifier)
        assertTrue(script.contains("'/api/desktop/auth/google'"))
        assertTrue(script.contains("'x-beacon-desktop': '1'"))
        assertTrue(script.contains("window.__beaconExchange"))
        assertTrue(script.contains(verifier))
        assertFailsWith<IllegalArgumentException> { WebShellPolicy.exchangeScript("c';alert(1);//", verifier) }
        assertFailsWith<IllegalArgumentException> { WebShellPolicy.exchangeScript("c".repeat(40), "short") }
    }

    @Test
    fun readsTheServersAnswerToTheExchange() {
        // evaluateJavascript returns the promise's string as a JSON string literal.
        fun literal(json: String) = org.json.JSONObject.quote(json)
        assertEquals("/settings", WebShellPolicy.exchangeDestination(literal("""{"ok":true,"body":{"redirect":"/settings"}}""")))
        assertNull(WebShellPolicy.exchangeDestination(literal("""{"ok":true,"body":{"redirect":"//evil.example"}}""")))
        assertNull(WebShellPolicy.exchangeDestination(literal("""{"ok":true,"body":{"redirect":"https://evil.example/"}}""")))
        assertNull(WebShellPolicy.exchangeDestination(literal("""{"ok":false,"body":null}""")))
        assertNull(WebShellPolicy.exchangeDestination(null))
        assertTrue(WebShellPolicy.exchangeNeedsLinking(literal("""{"ok":true,"body":{"status":"linkRequired"}}""")))
        assertFalse(WebShellPolicy.exchangeNeedsLinking(literal("""{"ok":true,"body":{"redirect":"/"}}""")))
    }
}
