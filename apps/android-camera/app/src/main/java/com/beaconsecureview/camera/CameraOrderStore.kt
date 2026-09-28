package com.beaconsecureview.camera

import android.content.Context

/** Account-scoped camera ordering stored only on this Android monitor device. */
class CameraOrderStore(context: Context) {
    private val preferences =
        context.getSharedPreferences("beacon_camera_order", Context.MODE_PRIVATE)

    fun read(userId: String): List<String> =
        preferences.getString(key(userId), null)?.lineSequence()?.filter(String::isNotBlank)?.toList()
            ?: emptyList()

    fun write(userId: String, cameraIds: List<String>) {
        preferences.edit().putString(key(userId), cameraIds.joinToString("\n")).apply()
    }

    private fun key(userId: String) = "user:$userId"
}

internal fun normalizedCameraOrder(savedIds: List<String>, availableIds: List<String>): List<String> {
    val available = availableIds.toSet()
    return savedIds.filter { it in available }.distinct() + availableIds.filter { it !in savedIds }
}
