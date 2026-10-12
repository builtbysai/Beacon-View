package com.beaconsecureview.camera

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.json.JSONObject

class NativeBridgeTest {
    private class FakeHost : NativeBridge.Host {
        override val appVersion = "0.1.0-test"
        val calls = mutableListOf<String>()

        override fun cameraState(): JSONObject = JSONObject().put("paired", false)

        override fun startCamera(code: String) { calls += "start:$code" }

        override fun openCameraScreen() { calls += "open" }

        override fun setPrivacy(enabled: Boolean) { calls += "privacy:$enabled" }

        override fun disconnectCamera() { calls += "disconnect" }

        override fun openUpdate() { calls += "update" }
    }

    private val host = FakeHost()
    private val bridge = NativeBridge(host)

    @Test
    fun helloTellsTheWebAppWhatThisAppIs() {
        val reply = JSONObject(bridge.handle("""{"id":"1","type":"hello"}""")!!)
        assertTrue(reply.getBoolean("ok"))
        assertEquals("1", reply.getString("id"))
        assertEquals("android", reply.getJSONObject("data").getString("app"))
        assertEquals("0.1.0-test", reply.getJSONObject("data").getString("version"))
    }

    @Test
    fun runsEachKnownMessageOnce() {
        bridge.handle("""{"id":"a","type":"startCamera","code":"abcd-234567"}""")
        bridge.handle("""{"id":"b","type":"setPrivacy","enabled":true}""")
        bridge.handle("""{"id":"c","type":"openCameraScreen"}""")
        bridge.handle("""{"id":"d","type":"disconnectCamera"}""")
        bridge.handle("""{"id":"e","type":"openUpdate"}""")
        assertEquals(listOf("start:ABCD234567", "privacy:true", "open", "disconnect", "update"), host.calls)
    }

    @Test
    fun dropsAnythingThatIsNotAValidMessage() {
        val bad =
            listOf(
                null,
                "",
                "not json",
                """{"type":"hello"}""",
                """{"id":"1","type":"nope"}""",
                """{"id":"has space","type":"hello"}""",
                """{"id":"${"x".repeat(65)}","type":"hello"}""",
                """{"id":"1","type":"startCamera","code":"short"}""",
                """{"id":"1","type":"startCamera"}""",
                """{"id":"1","type":"setPrivacy","enabled":"true"}""",
                """{"id":"1","type":"setPrivacy"}""",
                """{"id":"1","type":"hello","pad":"${"y".repeat(3_000)}"}""",
            )
        bad.forEach { assertNull(bridge.handle(it), "should drop: ${it?.take(60)}") }
        assertTrue(host.calls.isEmpty())
    }

    @Test
    fun cameraStateSaysWhetherTheCameraIsRunningAndPrivate() {
        val state =
            NativeBridgeProtocol.cameraState(
                paired = true,
                runtime = CameraRuntimeState(device = DeviceLifecycle.Idle, cameraEnabled = true, privacyMode = true, activeViewers = 2),
                deviceName = "Hall",
            )
        assertTrue(state.getBoolean("running"))
        assertTrue(state.getBoolean("privacy"))
        assertTrue(state.getBoolean("online"))
        assertEquals(2, state.getInt("viewers"))
        assertFalse(NativeBridgeProtocol.cameraState(false, CameraRuntimeState(cameraEnabled = true), "x").getBoolean("running"))
    }
}
