package com.beaconsecureview.camera

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

enum class MotionSensitivity(val wireValue: String, val threshold: Int, val changedFraction: Float) {
    Low("low", 40, 0.25f),
    Medium("medium", 28, 0.16f),
    High("high", 20, 0.08f),
}

data class MotionSettings(
    val enabled: Boolean = true,
    // Server-decided: the backend tells the device a recordingId to capture
    // and upload only when this is on, Drive is connected, and no recording
    // is already in flight for the camera. The device doesn't act on this
    // field itself, only on the response it produces.
    val recordOnMotion: Boolean = false,
    val sensitivity: MotionSensitivity = MotionSensitivity.Medium,
    val cooldownSeconds: Int = 30,
    val quietHours: QuietHours? = null,
) {
    init {
        require(cooldownSeconds in listOf(30, 60, 120, 300)) { "Unsupported motion cooldown" }
    }
}

data class QuietHours(
    val start: String,
    val end: String,
    val timeZone: String,
) {
    private val startMinute = parseMinute(start)
    private val endMinute = parseMinute(end)
    private val zoneId = ZoneId.of(timeZone)

    init {
        require(startMinute != endMinute) { "Quiet-hours start and end must differ" }
    }

    fun isActive(now: Instant = Instant.now()): Boolean {
        val local = ZonedDateTime.ofInstant(now, zoneId)
        val minute = local.hour * 60 + local.minute
        return if (startMinute < endMinute) minute >= startMinute && minute < endMinute
        else minute >= startMinute || minute < endMinute
    }

    private fun parseMinute(value: String): Int {
        require(Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(value)) { "Invalid quiet-hours time" }
        val (hour, minute) = value.split(":").map(String::toInt)
        return hour * 60 + minute
    }
}
