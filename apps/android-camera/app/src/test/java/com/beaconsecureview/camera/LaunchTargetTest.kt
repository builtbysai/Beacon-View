package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LaunchTargetTest {
    private val id = "0b8f2f4e-52f4-4f7a-9d1c-3f6d2a9c7e10"
    private val other = "7d3c1f0a-1e55-4a65-8b0f-0c2f9f6a1b22"

    private fun parse(action: String?, vararg extras: Pair<String, String>) =
        LaunchIntents.parse(action, { extras.toMap()[it] }, nowMillis = 1_000)

    @Test
    fun parsesACameraShortcut() {
        assertEquals(
            LaunchTarget.OpenCamera(id, 1_000),
            parse(LaunchIntents.ACTION_OPEN_CAMERA, LaunchIntents.EXTRA_CAMERA_ID to id),
        )
    }

    @Test
    fun parsesAnAlertByItsOpaqueEventId() {
        assertEquals(
            LaunchTarget.OpenAlert(id, 1_000),
            parse(LaunchIntents.ACTION_OPEN_ALERT, LaunchIntents.EXTRA_EVENT_ID to id),
        )
    }

    @Test
    fun parsesNamedPages() {
        assertEquals(
            LaunchTarget.OpenPage(MonitorPage.Cameras, 1_000),
            parse(LaunchIntents.ACTION_OPEN_PAGE, LaunchIntents.EXTRA_PAGE to "cameras"),
        )
        assertEquals(
            LaunchTarget.OpenPage(MonitorPage.Events, 1_000),
            parse(LaunchIntents.ACTION_OPEN_PAGE, LaunchIntents.EXTRA_PAGE to "activity"),
        )
    }

    @Test
    fun ignoresAnythingMalformedOrUnknown() {
        assertNull(parse(null))
        assertNull(parse("android.intent.action.MAIN"))
        assertNull(parse(LaunchIntents.ACTION_OPEN_CAMERA))
        assertNull(parse(LaunchIntents.ACTION_OPEN_CAMERA, LaunchIntents.EXTRA_CAMERA_ID to "not-an-id"))
        assertNull(parse(LaunchIntents.ACTION_OPEN_ALERT, LaunchIntents.EXTRA_EVENT_ID to "../../etc"))
        assertNull(parse(LaunchIntents.ACTION_OPEN_PAGE, LaunchIntents.EXTRA_PAGE to "admin"))
    }

    @Test
    fun aTargetNobodyGotToExpires() {
        val target = LaunchTarget.OpenCamera(id, receivedAtMillis = 10_000)
        assertTrue(LaunchIntents.isFresh(target, 10_000))
        assertTrue(LaunchIntents.isFresh(target, 10_000 + LaunchIntents.FRESH_MILLIS))
        assertFalse(LaunchIntents.isFresh(target, 10_001 + LaunchIntents.FRESH_MILLIS))
        assertFalse(LaunchIntents.isFresh(target, 9_999))
    }

    @Test
    fun aCameraOpensLiveOnlyWhenThePersonCanSeeIt() {
        val visible = listOf(id)
        assertEquals(
            LaunchResolution.Watch(id),
            resolveLaunch(LaunchTarget.OpenCamera(id, 0), visible, null),
        )
        assertEquals(
            LaunchResolution.Show(MonitorPage.Cameras),
            resolveLaunch(LaunchTarget.OpenCamera(other, 0), visible, null),
        )
    }

    @Test
    fun anAlertOpensItsCameraOrFallsBackToActivity() {
        val visible = listOf(id)
        assertEquals(
            LaunchResolution.Watch(id),
            resolveLaunch(LaunchTarget.OpenAlert(other, 0), visible, alertCameraId = id),
        )
        assertEquals(
            LaunchResolution.Show(MonitorPage.Events),
            resolveLaunch(LaunchTarget.OpenAlert(other, 0), visible, alertCameraId = null),
        )
        assertEquals(
            LaunchResolution.Show(MonitorPage.Events),
            resolveLaunch(LaunchTarget.OpenAlert(other, 0), visible, alertCameraId = other),
        )
    }

    @Test
    fun aPageTargetJustShowsThePage() {
        assertEquals(
            LaunchResolution.Show(MonitorPage.Settings),
            resolveLaunch(LaunchTarget.OpenPage(MonitorPage.Settings, 0), emptyList(), null),
        )
    }
}
