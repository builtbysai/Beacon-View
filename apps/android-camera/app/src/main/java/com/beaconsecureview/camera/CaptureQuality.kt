package com.beaconsecureview.camera

import android.content.Context

/**
 * Video size this phone captures (V71). Standard is the long-standing default and is easy on older phones; HD costs
 * more battery and heat, and the camera library falls back to the closest size the phone supports.
 */
enum class CaptureQuality(val label: String, val width: Int, val height: Int, val framerate: Int) {
    Standard("Standard (640 × 480)", 640, 480, 24),
    Hd("HD (1280 × 720)", 1280, 720, 24),
}

class CaptureQualityStore(context: Context) {
    private val preferences = context.getSharedPreferences("beacon_capture_quality", Context.MODE_PRIVATE)

    fun read(): CaptureQuality =
        CaptureQuality.entries.firstOrNull { it.name == preferences.getString("quality", null) } ?: CaptureQuality.Standard

    fun save(quality: CaptureQuality) {
        preferences.edit().putString("quality", quality.name).apply()
    }
}
