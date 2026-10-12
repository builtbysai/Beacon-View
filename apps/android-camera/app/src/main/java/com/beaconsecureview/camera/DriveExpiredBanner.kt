package com.beaconsecureview.camera

import android.content.Intent
import android.net.Uri
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Tells the household owner that Google stopped accepting the Drive connection, so new clips cannot be saved
 * (ADR 0116). The phone app cannot run Google's consent screen for Drive, so the button opens the web app's
 * Data & storage settings where it can be reconnected. Shown once per visit; dismissing hides it until the
 * next time the app opens.
 */
@Composable
internal fun DriveExpiredBanner(
    api: BeaconApi,
    sessionToken: String,
    isOwner: Boolean,
) {
    var expired by remember(sessionToken) { mutableStateOf(false) }
    var dismissed by remember(sessionToken) { mutableStateOf(false) }
    val context = LocalContext.current
    LaunchedEffect(sessionToken, isOwner) {
        if (!isOwner) return@LaunchedEffect
        val status = withContext(Dispatchers.IO) { runCatching { api.driveStatus(sessionToken) }.getOrNull() }
        expired = status?.expired == true
    }
    if (!isOwner || !expired || dismissed) return
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "Google Drive disconnected",
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Text(
                "New clips can't be saved until you reconnect. Clips already in your Drive are safe.",
                color = MaterialTheme.colorScheme.onErrorContainer,
                style = MaterialTheme.typography.bodyMedium,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = {
                        val url = "${BuildConfig.BEACON_WEB_URL.trimEnd('/')}/settings?section=data"
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    },
                ) { Text("Reconnect on the web") }
                TextButton(onClick = { dismissed = true }) { Text("Not now") }
            }
        }
    }
}
