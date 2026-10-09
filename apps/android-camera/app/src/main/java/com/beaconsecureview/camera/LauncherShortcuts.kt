package com.beaconsecureview.camera

import android.content.Context
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Launcher shortcuts (ADR 0095). Two static ones (Cameras and Activity) live in
 * `res/xml/shortcuts.xml`. The person's favorite cameras are added as dynamic shortcuts that open
 * the camera live. Dynamic shortcuts name cameras on the home screen, so they are removed when the
 * person signs out.
 */
internal object LauncherShortcuts {
    /** Static shortcuts take two of a launcher's usual four slots. */
    private const val MAX_FAVORITES = 2

    fun publish(context: Context, favorites: List<BeaconApi.MonitorCamera>) {
        val limit = minOf(MAX_FAVORITES, ShortcutManagerCompat.getMaxShortcutCountPerActivity(context))
        val shortcuts =
            favorites.take(limit).mapIndexed { index, camera ->
                ShortcutInfoCompat.Builder(context, shortcutId(camera.id))
                    .setShortLabel(shortLabel(camera.name))
                    .setLongLabel("Watch ${camera.name}")
                    .setIcon(IconCompat.createWithResource(context, R.mipmap.ic_launcher))
                    .setIntent(LaunchIntents.cameraIntent(context, camera.id))
                    .setRank(index)
                    .build()
            }
        runCatching { ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts) }
    }

    fun clear(context: Context) {
        runCatching { ShortcutManagerCompat.removeAllDynamicShortcuts(context) }
    }

    internal fun shortcutId(cameraId: String) = "camera:$cameraId"

    /** Launchers show about ten characters; keep the start of a long name. */
    internal fun shortLabel(name: String): String {
        val clean = name.trim().ifEmpty { "Camera" }
        return if (clean.length <= 14) clean else clean.take(13) + "…"
    }
}
