package com.beaconsecureview.camera

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle

/**
 * Copies a secret (a pairing or invitation code, a share link) and tells Android it is sensitive, so Android 13
 * and later hide it from the clipboard preview and keep it away from keyboards that offer clipboard history (V77).
 */
internal fun copySensitiveText(context: Context, text: String) {
    val manager = context.getSystemService(ClipboardManager::class.java) ?: return
    val clip = ClipData.newPlainText("Beacon", text)
    clip.description.extras =
        PersistableBundle().apply {
            val key = if (Build.VERSION.SDK_INT >= 33) ClipDescription.EXTRA_IS_SENSITIVE else "android.content.extra.IS_SENSITIVE"
            putBoolean(key, true)
        }
    manager.setPrimaryClip(clip)
}
