package com.beaconsecureview.camera

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Mirrors the PWA Account section's profile card: email, verification
 * status, and Google sign-in-method status. Owns its own load/action state,
 * matching this session's other Settings panels (HouseholdSharingPanel.kt).
 * "Link your Google account" is deliberately not a button here -- doing that
 * from Android needs its own OAuth-intent design (the existing Google
 * sign-in flow is for signing in, not linking an already-signed-in
 * password account), so this only ever displays status, never a broken
 * action. */
@Composable
internal fun BeaconAccountProfileCard(
    api: BeaconApi,
    sessionToken: String,
    onAuthorizationLost: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var details by remember { mutableStateOf<BeaconApi.AccountDetails?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf("") }

    LaunchedEffect(sessionToken) {
        val result = withContext(Dispatchers.IO) { runCatching { api.accountDetails(sessionToken) } }
        result.onSuccess { details = it }.onFailure {
            if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("Account details are temporarily unavailable")
        }
        loaded = true
    }

    val current = details
    if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 8.dp))
    when {
        !loaded -> Text("Loading account details…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        current != null -> {
            Text(current.email, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                if (current.emailVerified) "Email verified" else "Email not verified",
                color = if (current.emailVerified) BeaconOnline else MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 4.dp),
            )
            if (!current.emailVerified) {
                if (notice.isNotBlank()) {
                    Text(notice, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                }
                OutlinedButton(
                    enabled = !busy,
                    onClick = {
                        busy = true
                        notice = ""
                        error = ""
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.requestEmailVerification(sessionToken) } }
                            result.onSuccess { notice = "Verification email sent." }.onFailure {
                                if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("The verification email could not be sent.")
                            }
                            busy = false
                        }
                    },
                    modifier = Modifier.padding(top = 8.dp),
                ) { Text(if (busy) "Sending…" else "Send verification email") }
            }
            Text(
                if (current.googleLinked) "Google account linked" else "Google account not linked",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 10.dp),
            )
            Text(
                if (current.hasPassword) "Password sign-in enabled" else "No password set",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

/** Mirrors the PWA's GoogleDriveSettings.tsx status card. Read-only plus
 * disconnect/verify -- initiating a *new* connection needs a browser OAuth
 * round trip the backend does not yet support for a bearer-token mobile
 * client (see docs/development-handoff.md), so there is deliberately no
 * "Connect" button here rather than one that would silently fail. */
@Composable
internal fun BeaconGoogleDriveCard(
    api: BeaconApi,
    sessionToken: String,
    onAuthorizationLost: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<BeaconApi.DriveStatus?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf("") }

    fun refresh() {
        loaded = false
        scope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { api.driveStatus(sessionToken) } }
            result.onSuccess {
                status = it
                error = ""
            }.onFailure {
                if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("Google Drive status is temporarily unavailable")
            }
            loaded = true
        }
    }
    LaunchedEffect(sessionToken) { refresh() }

    Text("Google Drive", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 14.dp))
    Text(
        "Store Beacon app data and optional recordings in your Drive.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 6.dp))
    if (notice.isNotBlank()) Text(notice, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
    val current = status
    when {
        !loaded -> Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
        current == null -> Unit
        !current.configured -> Text("Google Drive is not configured on this Beacon server.", modifier = Modifier.padding(top = 6.dp))
        current.expired -> Text(
            "Google stopped accepting this connection. Reconnect Google Drive from the web app so clips can be saved again.",
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.padding(top = 6.dp),
        )
        !current.connected -> Text(
            "Not connected. Connect Google Drive from the web app to enable it here too.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
        )
        else -> {
            Text(
                current.providerEmail?.let { "Connected as $it" } ?: "Connected",
                color = BeaconOnline,
                modifier = Modifier.padding(top = 6.dp),
            )
            Text(
                if (current.recordingsConnected) "Clip uploads are enabled." else "Clip uploads are not enabled for this connection.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    enabled = !busy,
                    onClick = {
                        busy = true
                        notice = ""
                        error = ""
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.verifyDrive(sessionToken) } }
                            result.onSuccess { notice = "Google Drive access verified." }.onFailure {
                                if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("Google Drive verification failed.")
                            }
                            busy = false
                        }
                    },
                ) { Text(if (busy) "Checking…" else "Verify access") }
                OutlinedButton(
                    enabled = !busy,
                    onClick = {
                        busy = true
                        notice = ""
                        error = ""
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.disconnectDrive(sessionToken) } }
                            result.onSuccess { refresh() }.onFailure {
                                if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("Google Drive could not be disconnected.")
                            }
                            busy = false
                        }
                    },
                ) { Text(if (busy) "Disconnecting…" else "Disconnect") }
            }
        }
    }
}
