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
        var pushToken: Result<JSONObject> = Result.success(JSONObject().put("token", "tok").put("installationId", "inst"))
        var disabledSubscription: Result<String?> = Result.success("sub-12345678")

        override fun cameraState(): JSONObject = JSONObject().put("paired", false)

        override fun pushState(): JSONObject = JSONObject().put("enabled", false).put("stale", false)

        override fun startCamera(code: String) {
            calls += "start:$code"
        }

        override fun openCameraScreen() {
            calls += "open"
        }

        override fun setPrivacy(enabled: Boolean) {
            calls += "privacy:$enabled"
        }

        override fun disconnectCamera() {
            calls += "disconnect"
        }

        override fun openUpdate() {
            calls += "update"
        }

        override fun enablePush(done: (Result<JSONObject>) -> Unit) {
            calls += "enablePush"
            done(pushToken)
        }

        override fun pushEnabled(subscriptionId: String) {
            calls += "pushEnabled:$subscriptionId"
        }

        override fun disablePush(done: (Result<String?>) -> Unit) {
            calls += "disablePush"
            done(disabledSubscription)
        }

        override var pipSupported = true
        var pipEntered = true

        override fun enterPip(): Boolean {
            calls += "enterPip"
            return pipEntered
        }

        override fun setPipReady(ready: Boolean) {
            calls += "pipReady:$ready"
        }

        override fun saveFileStart(name: String, mime: String): String? {
            calls += "saveStart:$name:$mime"
            return "123e4567-e89b-12d3-a456-426614174000"
        }

        override fun saveFileChunk(token: String, base64: String): Boolean {
            calls += "saveChunk:${base64.length}"
            return base64 != "FAIL"
        }

        override fun saveFileEnd(token: String): String? {
            calls += "saveEnd"
            return "clip.mp4"
        }
    }

    private val host = FakeHost()
    private val bridge = NativeBridge(host)

    private fun send(raw: String?): String? {
        var reply: String? = null
        bridge.handle(raw) { reply = it }
        return reply
    }

    @Test
    fun helloTellsTheWebAppWhatThisAppIs() {
        val reply = JSONObject(send("""{"id":"1","type":"hello"}""")!!)
        assertTrue(reply.getBoolean("ok"))
        assertEquals("1", reply.getString("id"))
        val data = reply.getJSONObject("data")
        assertEquals("android", data.getString("app"))
        assertEquals("0.1.0-test", data.getString("version"))
        assertFalse(data.getJSONObject("push").getBoolean("enabled"))
    }

    @Test
    fun runsEachKnownMessageOnce() {
        send("""{"id":"a","type":"startCamera","code":"abcd-234567"}""")
        send("""{"id":"b","type":"setPrivacy","enabled":true}""")
        send("""{"id":"c","type":"openCameraScreen"}""")
        send("""{"id":"d","type":"disconnectCamera"}""")
        send("""{"id":"e","type":"openUpdate"}""")
        send("""{"id":"f","type":"pushEnabled","subscriptionId":"sub-12345678"}""")
        assertEquals(
            listOf("start:ABCD234567", "privacy:true", "open", "disconnect", "update", "pushEnabled:sub-12345678"),
            host.calls,
        )
    }

    @Test
    fun floatingTheVideoIsRefusedWhenThePhoneCannotDoIt() {
        assertTrue(JSONObject(send("""{"id":"a","type":"hello"}""")!!).getJSONObject("data").getBoolean("pip"))
        assertTrue(JSONObject(send("""{"id":"b","type":"enterPip"}""")!!).getBoolean("ok"))
        send("""{"id":"c","type":"pipReady","ready":true}""")
        assertNull(send("""{"id":"d","type":"pipReady","ready":"yes"}"""))
        host.pipEntered = false
        assertFalse(JSONObject(send("""{"id":"e","type":"enterPip"}""")!!).getBoolean("ok"))
        host.pipSupported = false
        assertFalse(JSONObject(send("""{"id":"f","type":"enterPip"}""")!!).getBoolean("ok"))
        assertEquals(listOf("enterPip", "pipReady:true", "enterPip"), host.calls)
    }

    @Test
    fun phoneAlertsAnswerWithTheTokenOrTheSubscriptionToRemove() {
        val enabled = JSONObject(send("""{"id":"p","type":"enablePush"}""")!!)
        assertEquals("tok", enabled.getJSONObject("data").getString("token"))
        assertEquals("inst", enabled.getJSONObject("data").getString("installationId"))
        val disabled = JSONObject(send("""{"id":"q","type":"disablePush"}""")!!)
        assertEquals("sub-12345678", disabled.getJSONObject("data").getString("subscriptionId"))
        host.pushToken = Result.failure(IllegalStateException("no firebase"))
        val failed = JSONObject(send("""{"id":"r","type":"enablePush"}""")!!)
        assertFalse(failed.getBoolean("ok"))
    }

    @Test
    fun savesAFileInPiecesAndSaysWhereItWent() {
        val token = "123e4567-e89b-12d3-a456-426614174000"
        val started = JSONObject(send("""{"id":"s","type":"saveFileStart","name":"clip.mp4","mime":"video/mp4"}""")!!)
        assertEquals(token, started.getJSONObject("data").getString("token"))
        assertTrue(JSONObject(send("""{"id":"t","type":"saveFileChunk","token":"$token","data":"QUJD"}""")!!).getBoolean("ok"))
        assertFalse(JSONObject(send("""{"id":"u","type":"saveFileChunk","token":"$token","data":"FAIL"}""")!!).getBoolean("ok"))
        val ended = JSONObject(send("""{"id":"v","type":"saveFileEnd","token":"$token"}""")!!)
        assertEquals("clip.mp4", ended.getJSONObject("data").getString("name"))
        assertEquals(listOf("saveStart:clip.mp4:video/mp4", "saveChunk:4", "saveChunk:4", "saveEnd"), host.calls)
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
                """{"id":"1","type":"pushEnabled","subscriptionId":"x"}""",
                """{"id":"1","type":"pushEnabled"}""",
                """{"id":"1","type":"hello","pad":"${"y".repeat(3_000)}"}""",
            )
        bad.forEach {
            var answered = false
            assertFalse(bridge.handle(it) { answered = true }, "should drop: ${it?.take(60)}")
            assertFalse(answered)
        }
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

class SaveRulesTest {
    @Test
    fun fileNamesLoseTheirPathAndAnythingUnsafe() {
        assertEquals("clip.mp4", SaveRules.safeName("../../etc/clip.mp4"))
        assertEquals("clip.mp4", SaveRules.safeName("C:\\Users\\me\\clip.mp4"))
        assertEquals("a b.png", SaveRules.safeName("a<> b|?.png"))
        assertEquals("Beacon download", SaveRules.safeName("..."))
        assertEquals("Beacon download", SaveRules.safeName("   "))
        assertEquals(120, SaveRules.safeName("x".repeat(500)).length)
    }

    @Test
    fun onlyPlainMimeTypesAreKept() {
        assertEquals("video/mp4", SaveRules.safeMime("Video/MP4"))
        assertEquals("application/octet-stream", SaveRules.safeMime("text/html; charset=utf-8"))
        assertEquals("application/octet-stream", SaveRules.safeMime(""))
        assertEquals("application/octet-stream", SaveRules.safeMime("javascript:alert(1)"))
    }
}

class SaveMessageTest {
    private val token = "123e4567-e89b-12d3-a456-426614174000"

    @Test
    fun readsTheThreeSaveMessagesAndOnlyThePieceMayBeLarge() {
        assertEquals(
            BridgeRequest.SaveFileStart("a.png", "image/png"),
            NativeBridgeProtocol.parse("""{"id":"1","type":"saveFileStart","name":"a.png","mime":"image/png"}""")?.request,
        )
        val big = "A".repeat(200_000)
        assertEquals(
            BridgeRequest.SaveFileChunk(token, big),
            NativeBridgeProtocol.parse("""{"id":"2","type":"saveFileChunk","token":"$token","data":"$big"}""")?.request,
        )
        assertEquals(
            BridgeRequest.SaveFileEnd(token),
            NativeBridgeProtocol.parse("""{"id":"3","type":"saveFileEnd","token":"$token"}""")?.request,
        )
        // A big message of any other type is refused.
        assertNull(NativeBridgeProtocol.parse("""{"id":"4","type":"saveFileStart","name":"a","pad":"$big"}"""))
        assertNull(NativeBridgeProtocol.parse("""{"id":"5","type":"saveFileChunk","token":"nope","data":"AAAA"}"""))
        assertNull(NativeBridgeProtocol.parse("""{"id":"6","type":"saveFileChunk","token":"$token","data":""}"""))
        assertNull(NativeBridgeProtocol.parse("""{"id":"7","type":"saveFileStart","name":""}"""))
    }
}
