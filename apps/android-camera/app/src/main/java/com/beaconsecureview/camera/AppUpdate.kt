package com.beaconsecureview.camera

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** A newer sideloaded build that the server publishes (ADR 0118). */
internal data class AvailableUpdate(val version: String, val file: String)

private val ANDROID_FILE = Regex("^Beacon-android-([A-Za-z0-9.-]+)\\.apk$")

/** Parses the downloads manifest for the Android app; null when none is published. */
internal fun parseAndroidUpdate(manifestJson: String): AvailableUpdate? {
    val files = JSONObject(manifestJson).optJSONArray("files") ?: return null
    for (index in 0 until files.length()) {
        val entry = files.getJSONObject(index)
        if (entry.optString("platform") != "android") continue
        val name = entry.optString("file")
        val match = ANDROID_FILE.matchEntire(name) ?: continue
        return AvailableUpdate(match.groupValues[1], name)
    }
    return null
}

/**
 * Is [latest] newer than [installed]? Versions look like "0.1.0-alpha10": numbers compare as numbers (so
 * alpha10 is after alpha9), text compares as text, and a release with no suffix beats its own alphas.
 */
internal fun isNewerVersion(latest: String, installed: String): Boolean {
    fun tokens(version: String) = Regex("\\d+|[A-Za-z]+").findAll(version).map { it.value }.toList()
    val a = tokens(latest)
    val b = tokens(installed)
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrNull(i)
        val y = b.getOrNull(i)
        if (x == y) continue
        // Running out of tokens means a release without the alpha suffix, which is later.
        if (x == null) return true
        if (y == null) return false
        val xn = x.toIntOrNull()
        val yn = y.toIntOrNull()
        return if (xn != null && yn != null) xn > yn else x > y
    }
    return false
}

/** Installed from Google Play? Play delivers its own updates, so the sideload prompt stays out of the way. */
internal fun installedFromPlay(context: Context): Boolean =
    try {
        val installer =
            if (Build.VERSION.SDK_INT >= 30) {
                context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getInstallerPackageName(context.packageName)
            }
        installer == "com.android.vending"
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

private fun fetchLatest(): AvailableUpdate? =
    runCatching {
        val connection =
            (URL("${BuildConfig.BEACON_WEB_URL.trimEnd('/')}/downloads/manifest.json").openConnection() as HttpURLConnection)
                .apply {
                    connectTimeout = 8_000
                    readTimeout = 8_000
                    useCaches = false
                }
        try {
            if (connection.responseCode != 200) null
            else parseAndroidUpdate(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }.getOrNull()

/** The update to offer, or null: none published, nothing newer, or a Play install. */
internal suspend fun checkForAppUpdate(context: Context): AvailableUpdate? {
    if (installedFromPlay(context)) return null
    val latest = withContext(Dispatchers.IO) { fetchLatest() } ?: return null
    return latest.takeIf { isNewerVersion(it.version, BuildConfig.VERSION_NAME) }
}

internal fun openUpdateDownload(context: Context, update: AvailableUpdate) {
    val url = "${BuildConfig.BEACON_WEB_URL.trimEnd('/')}/downloads/${update.file}"
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
}
