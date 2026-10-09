package com.beaconsecureview.camera

import java.time.LocalDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LiveViewToolsTest {
    private val width = 1000f
    private val height = 600f

    @Test
    fun zoomNeverLeavesEmptyMargins() {
        val zoomed = zoomAt(ZoomState.Identity, 2f, 0f, 0f, width, height)
        assertEquals(2f, zoomed.scale)
        // Panning far past the edge stops at the picture's edge.
        val panned = panBy(zoomed, 5_000f, 5_000f, width, height)
        assertEquals(0f, panned.x)
        assertEquals(0f, panned.y)
        val other = panBy(zoomed, -5_000f, -5_000f, width, height)
        assertEquals(width - 2f * width, other.x)
        assertEquals(height - 2f * height, other.y)
    }

    @Test
    fun zoomKeepsThePictureUnderTheFingerWhereItIs() {
        val zoomed = zoomAt(ZoomState.Identity, 2f, 500f, 300f, width, height)
        // A pinch at the centre of the picture scales it about that point.
        assertEquals(-500f, zoomed.x)
        assertEquals(-300f, zoomed.y)
    }

    @Test
    fun zoomIsLimitedAndBackToOneResets() {
        assertEquals(ZoomState.MAX_SCALE, zoomAt(ZoomState.Identity, 100f, 0f, 0f, width, height).scale)
        val zoomed = zoomAt(ZoomState.Identity, 3f, 100f, 100f, width, height)
        assertEquals(ZoomState.Identity, zoomAt(zoomed, 0.01f, 100f, 100f, width, height))
    }

    @Test
    fun panDoesNothingWhenNotZoomed() {
        assertEquals(ZoomState.Identity, panBy(ZoomState.Identity, 40f, 40f, width, height))
        assertFalse(ZoomState.Identity.zoomed)
        assertTrue(zoomAt(ZoomState.Identity, 2f, 0f, 0f, width, height).zoomed)
    }

    private class Talk(var time: Long = 0) {
        var talking = false
        var starts = 0
        var stops = 0
        val button =
            PushToTalk(
                talking = { talking },
                start = { talking = true; starts += 1 },
                stop = { talking = false; stops += 1 },
                now = { time },
            )
    }

    @Test
    fun aQuickTapLeavesTalkingOnUntilTappedAgain() {
        val talk = Talk()
        talk.button.press()
        talk.time = 150
        talk.button.release()
        assertTrue(talk.talking)
        talk.time = 5_000
        talk.button.press()
        talk.button.release()
        assertFalse(talk.talking)
        assertEquals(1, talk.starts)
        assertEquals(1, talk.stops)
    }

    @Test
    fun aHoldTalksOnlyWhileHeld() {
        val talk = Talk()
        talk.button.press()
        assertTrue(talk.talking)
        talk.time = PushToTalk.HOLD_MILLIS
        talk.button.release()
        assertFalse(talk.talking)
    }

    @Test
    fun aSecondPressWhileDownDoesNothing() {
        val talk = Talk()
        talk.button.press()
        talk.button.press()
        assertEquals(1, talk.starts)
    }

    @Test
    fun releasingWithoutPressingDoesNothing() {
        val talk = Talk()
        talk.button.release()
        assertEquals(0, talk.stops)
    }

    @Test
    fun aTapWithoutAPointerBehavesLikeAQuickTap() {
        val talk = Talk()
        talk.button.tap()
        assertTrue(talk.talking)
        talk.button.tap()
        assertFalse(talk.talking)
    }

    @Test
    fun snapshotNamesCarryTheCameraAndTheTimeAndAreFileSafe() {
        val at = LocalDateTime.of(2026, 10, 8, 9, 5, 7)
        assertEquals("Beacon Front door 2026-10-08 09-05-07.png", snapshotFileName("Front door", at))
        assertEquals("Beacon MomDad 2026-10-08 09-05-07.png", snapshotFileName("Mom/Dad:*?", at))
        assertEquals("Beacon Camera 2026-10-08 09-05-07.png", snapshotFileName("///", at))
        assertTrue(snapshotFileName("x".repeat(200), at).length < 80)
    }
}
