package com.beaconsecureview.camera

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Mirrors the PWA Settings page's "Household" card: name plus a couple of
 * always-available stats. People count is deliberately omitted here --
 * getting it requires the admin-only /api/household/sharing call, which a
 * viewer/guest can't make; the People & access panel below shows the real
 * member list for admins instead of duplicating a count here. */
@Composable
internal fun BeaconHouseholdOverviewCard(
    household: BeaconApi.HouseholdSummary?,
    cameraCount: Int,
) {
    BeaconSectionHeader("Household", "Your shared Beacon space.")
    BeaconPanel(modifier = Modifier.fillMaxWidth()) {
        if (household == null) {
            Text("Loading household…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Text(household.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(28.dp),
            ) {
                BeaconHouseholdStat("CAMERAS", cameraCount.toString())
                BeaconHouseholdStat("YOUR ROLE", household.role.replaceFirstChar { it.uppercase() })
            }
        }
    }
}

@Composable
private fun BeaconHouseholdStat(label: String, value: String) {
    Column {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Bold,
        )
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
    }
}

/** Mirrors the PWA's HouseholdSharingSettings.tsx People & access section:
 * invite, accept, and revoke household membership. Owns its own network
 * calls (like ShareClipDialog in RecordingLibrary.kt) rather than hoisting
 * list state up to MonitorHome, since nothing else in that already-large
 * function needs to observe or reset this panel's state.
 *
 * Scope note: per-camera grant editing (PUT .../members/:id/grants) is not
 * implemented here -- this covers membership (invite/accept/revoke) only. */
@Composable
internal fun BeaconPeopleAccessPanel(
    api: BeaconApi,
    sessionToken: String,
    isAdmin: Boolean,
    onAuthorizationLost: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var sharing by remember { mutableStateOf<BeaconApi.HouseholdSharing?>(null) }
    var loaded by remember { mutableStateOf(!isAdmin) }
    var error by remember { mutableStateOf("") }
    var busyId by remember { mutableStateOf<String?>(null) }
    var inviteOpen by remember { mutableStateOf(false) }
    var joinOpen by remember { mutableStateOf(false) }

    fun refresh() {
        if (!isAdmin) return
        loaded = false
        scope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { api.householdSharing(sessionToken) } }
            result.onSuccess {
                sharing = it
                error = ""
            }.onFailure {
                if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("Household members are temporarily unavailable")
            }
            loaded = true
        }
    }
    LaunchedEffect(sessionToken) { refresh() }

    BeaconSectionHeader("People & access", "Manage who belongs to this household and what they can access.")
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (isAdmin) {
            Button(onClick = { inviteOpen = true }, modifier = Modifier.weight(1f)) { Text("Invite person") }
        }
        OutlinedButton(onClick = { joinOpen = true }, modifier = Modifier.weight(1f)) { Text("Join household") }
    }

    if (isAdmin) {
        BeaconPanel(modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) {
            val current = sharing
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 8.dp))
            when {
                !loaded -> Text("Loading members…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                current == null -> Unit
                else -> Column {
                    current.members.forEach { member ->
                        BeaconMemberRow(
                            email = member.email,
                            role = member.role,
                            busy = busyId == member.id,
                            canRemove = member.role != "owner",
                            onRemove = {
                                busyId = member.id
                                scope.launch {
                                    val result = withContext(Dispatchers.IO) { runCatching { api.removeHouseholdMember(sessionToken, member.id) } }
                                    result.onSuccess { refresh() }.onFailure {
                                        if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("This member could not be removed.")
                                    }
                                    busyId = null
                                }
                            },
                        )
                    }
                    current.invitations.forEach { invitation ->
                        BeaconInvitationRow(
                            email = invitation.invitedEmail,
                            role = invitation.role,
                            busy = busyId == invitation.id,
                            onRevoke = {
                                busyId = invitation.id
                                scope.launch {
                                    val result = withContext(Dispatchers.IO) { runCatching { api.revokeHouseholdInvitation(sessionToken, invitation.id) } }
                                    result.onSuccess { refresh() }.onFailure {
                                        if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("This invitation could not be revoked.")
                                    }
                                    busyId = null
                                }
                            },
                        )
                    }
                    if (current.members.isEmpty() && current.invitations.isEmpty()) {
                        Text("No one else is in this household yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }

    if (inviteOpen) {
        InvitePersonDialog(
            api = api,
            sessionToken = sessionToken,
            onDismiss = { inviteOpen = false },
            onCreated = { refresh() },
        )
    }
    if (joinOpen) {
        JoinHouseholdDialog(
            api = api,
            sessionToken = sessionToken,
            onDismiss = { joinOpen = false },
            onJoined = { refresh() },
        )
    }
}

@Composable
private fun BeaconMemberRow(
    email: String,
    role: String,
    busy: Boolean,
    canRemove: Boolean,
    onRemove: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(email, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(role.replaceFirstChar { it.uppercase() }, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        if (canRemove) {
            OutlinedButton(enabled = !busy, onClick = onRemove) { Text(if (busy) "Removing…" else "Remove") }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun BeaconInvitationRow(
    email: String,
    role: String,
    busy: Boolean,
    onRevoke: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(email, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Invited · ${role.replaceFirstChar { it.uppercase() }}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        OutlinedButton(enabled = !busy, onClick = onRevoke) { Text(if (busy) "Revoking…" else "Revoke") }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun InvitePersonDialog(
    api: BeaconApi,
    sessionToken: String,
    onDismiss: () -> Unit,
    onCreated: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("viewer") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var created by remember { mutableStateOf<BeaconApi.CreatedInvitation?>(null) }
    var copied by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Invite to your household") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                val invitation = created
                if (invitation != null) {
                    Text("Share this code. It expires ${formatRecordingTime(invitation.expiresAt)}.")
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            invitation.token,
                            modifier = Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.bodySmall,
                        )
                        TextButton(onClick = {
                            clipboard.setText(AnnotatedString(invitation.token))
                            copied = true
                        }) { Text(if (copied) "Copied" else "Copy") }
                    }
                } else {
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it; error = "" },
                        label = { Text("Email") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text("Role", style = MaterialTheme.typography.labelMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("admin" to "Admin", "viewer" to "Viewer", "guest" to "Guest").forEach { (value, label) ->
                            val selected = role == value
                            OutlinedButton(
                                onClick = { role = value },
                                colors =
                                    ButtonDefaults.outlinedButtonColors(
                                        containerColor = if (selected) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent,
                                    ),
                            ) { Text(label) }
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (created == null) {
                Button(
                    enabled = email.isNotBlank() && !busy,
                    onClick = {
                        busy = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.createHouseholdInvitation(sessionToken, email.trim(), role) } }
                            result.onSuccess {
                                created = it
                                onCreated()
                            }.onFailure { error = it.userFacingMessage("The invitation could not be created.") }
                            busy = false
                        }
                    },
                ) { Text(if (busy) "Sending…" else "Send invite") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(if (created != null) "Done" else "Cancel") } },
    )
}

@Composable
private fun JoinHouseholdDialog(
    api: BeaconApi,
    sessionToken: String,
    onDismiss: () -> Unit,
    onJoined: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var token by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var joined by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Join a household") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                if (joined) {
                    Text(
                        "You've joined the household. Sign out and back in if it doesn't switch to it " +
                            "automatically.",
                    )
                } else {
                    Text("Enter the invitation code someone shared with you.")
                    OutlinedTextField(
                        value = token,
                        onValueChange = { token = it; error = "" },
                        label = { Text("Invitation code") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        confirmButton = {
            if (!joined) {
                Button(
                    enabled = token.isNotBlank() && !busy,
                    onClick = {
                        busy = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) { runCatching { api.acceptHouseholdInvitation(sessionToken, token.trim()) } }
                            result.onSuccess {
                                joined = true
                                onJoined()
                            }.onFailure { error = it.userFacingMessage("That invitation code is invalid or has expired.") }
                            busy = false
                        }
                    },
                ) { Text(if (busy) "Joining…" else "Join") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(if (joined) "Done" else "Cancel") } },
    )
}

/** Mirrors the PWA's BrowserSessions.tsx: lists every session on the
 * account (this device included) and lets the owner revoke any other one.
 * Rendered directly under the existing Security section header, matching
 * the bare (non-BeaconPanel-wrapped) style AccessEventRow already uses
 * there. */
@Composable
internal fun BeaconSignedInDevicesPanel(
    api: BeaconApi,
    sessionToken: String,
    onAuthorizationLost: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var sessions by remember { mutableStateOf<List<BeaconApi.BrowserSessionSummary>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var busyId by remember { mutableStateOf<String?>(null) }

    fun refresh() {
        loaded = false
        scope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { api.browserSessions(sessionToken) } }
            result.onSuccess {
                sessions = it
                error = ""
            }.onFailure {
                if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("Signed-in devices are temporarily unavailable")
            }
            loaded = true
        }
    }
    LaunchedEffect(sessionToken) { refresh() }

    Text("Signed-in devices", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 14.dp))
    if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
    when {
        !loaded -> Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> sessions.forEach { entry ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(entry.userAgent, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        if (entry.current) "This device · active now" else "Last active ${formatRecordingTime(entry.lastSeenAt)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (entry.current) {
                    BeaconStatusPill("Current", BeaconOnline)
                } else {
                    OutlinedButton(
                        enabled = busyId == null,
                        onClick = {
                            busyId = entry.id
                            scope.launch {
                                val result = withContext(Dispatchers.IO) { runCatching { api.revokeBrowserSession(sessionToken, entry.id) } }
                                result.onSuccess { refresh() }.onFailure {
                                    if (it is AuthorizationLostException) onAuthorizationLost() else error = it.userFacingMessage("This session could not be revoked.")
                                }
                                busyId = null
                            }
                        },
                    ) { Text(if (busyId == entry.id) "Revoking…" else "Revoke") }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}
