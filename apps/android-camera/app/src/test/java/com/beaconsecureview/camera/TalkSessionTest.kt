package com.beaconsecureview.camera

import org.junit.Assert.assertEquals
import org.junit.Test

class TalkSessionTest {
    @Test
    fun talkStatusTextMatchesThePwaCopyForEveryNonIdleState() {
        assertEquals("Allow microphone access to talk.", talkStatusText(TalkState.Permission))
        assertEquals("Connecting talk…", talkStatusText(TalkState.Connecting))
        assertEquals("Speaking · microphone on", talkStatusText(TalkState.Speaking))
        assertEquals("Another viewer is talking.", talkStatusText(TalkState.Busy))
        assertEquals("Microphone off · reconnecting", talkStatusText(TalkState.Recovering))
        assertEquals("Talk unavailable.", talkStatusText(TalkState.Unavailable))
    }

    @Test
    fun talkStatusTextIsBlankForIdle() {
        assertEquals("", talkStatusText(TalkState.Idle))
    }
}
