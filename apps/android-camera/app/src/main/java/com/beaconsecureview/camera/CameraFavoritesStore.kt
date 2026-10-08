package com.beaconsecureview.camera

import android.content.Context

/** Account-scoped local camera preferences. Camera IDs and user IDs are opaque server UUIDs. */
class CameraFavoritesStore(context: Context) {
    private val preferences =
        context.getSharedPreferences("beacon_camera_favorites", Context.MODE_PRIVATE)

    fun read(userId: String): Set<String> =
        preferences.getStringSet(key(userId), emptySet())?.toSet() ?: emptySet()

    fun hasSaved(userId: String): Boolean = preferences.contains(key(userId))

    fun replace(userId: String, cameraIds: Set<String>) {
        preferences.edit().putStringSet(key(userId), cameraIds).apply()
    }

    fun toggle(userId: String, cameraId: String): Set<String> {
        val updated = toggledFavoriteIds(read(userId), cameraId)
        preferences.edit().putStringSet(key(userId), updated).apply()
        return updated
    }

    private fun key(userId: String) = "user:$userId"
}

internal fun toggledFavoriteIds(current: Set<String>, cameraId: String): Set<String> =
    current.toMutableSet().apply {
        if (!add(cameraId)) remove(cameraId)
    }
