package com.beaconsecureview.camera

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun ColumnScope.MonitorSettingsPage(
    state: MonitorHomeState,
    currentSession: BeaconApi.AccountSession,
) {
    with(state) {
            Spacer(Modifier.height(1.dp).onGloballyPositioned { settingsSectionOffsets["Household"] = it.positionInParent().y.roundToInt() })
            BeaconHouseholdOverviewCard(household = household, cameraCount = cameras.size, api = api, sessionToken = currentSession.token)
            Spacer(Modifier.height(1.dp).onGloballyPositioned { settingsSectionOffsets["Notifications"] = it.positionInParent().y.roundToInt() })
            BeaconSectionHeader("Notifications", "Control private alerts from this phone.")
            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                Text("Notifications", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Button(
                    enabled = !notificationBusy,
                    onClick = {
                        if (notificationConsent) {
                            val active = session
                            NotificationConsentStore(context).mute()
                            notificationConsent = false
                            notificationBusy = true
                            scope.launch {
                                withContext(Dispatchers.IO) { disableAndroidNotifications(context, api, active) }
                                notificationBusy = false
                                message = "Notifications are off on this device."
                            }
                        } else if (
                            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                        ) {
                            alertPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            enableNotifications()
                        }
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                ) { Text(if (notificationBusy) "Updating…" else if (notificationConsent) "Turn off notifications" else "Turn on notifications") }
                notificationPreferences.forEach { preference ->
                    Text(preference.deviceName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 14.dp))
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text("Motion alerts", modifier = Modifier.weight(1f))
                        Switch(
                            checked = preference.motionEnabled,
                            enabled = !notificationBusy,
                            modifier = Modifier.semantics { contentDescription = "Motion alerts for ${preference.deviceName}" },
                            onCheckedChange = { checked ->
                                val changed = preference.copy(motionEnabled = checked)
                                notificationPreferences = notificationPreferences.map { if (it.deviceId == changed.deviceId) changed else it }
                                notificationBusy = true
                                scope.launch {
                                    val result = withContext(Dispatchers.IO) { runCatching { api.updateNotificationPreference(currentSession.token, changed) } }
                                    result.onSuccess { saved -> notificationPreferences = notificationPreferences.map { if (it.deviceId == saved.deviceId) saved else it } }
                                        .onFailure { message = it.userFacingMessage("Notification preferences could not be saved") }
                                    notificationBusy = false
                                }
                            },
                        )
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text("Camera problem alerts", modifier = Modifier.weight(1f))
                        Switch(
                            checked = preference.offlineEnabled,
                            enabled = !notificationBusy,
                            modifier = Modifier.semantics { contentDescription = "Camera problem alerts for ${preference.deviceName}" },
                            onCheckedChange = { checked ->
                                val changed = preference.copy(offlineEnabled = checked)
                                notificationPreferences = notificationPreferences.map { if (it.deviceId == changed.deviceId) changed else it }
                                notificationBusy = true
                                scope.launch {
                                    val result = withContext(Dispatchers.IO) { runCatching { api.updateNotificationPreference(currentSession.token, changed) } }
                                    result.onSuccess { saved -> notificationPreferences = notificationPreferences.map { if (it.deviceId == saved.deviceId) saved else it } }
                                        .onFailure { message = it.userFacingMessage("Notification preferences could not be saved") }
                                    notificationBusy = false
                                }
                            },
                        )
                    }
                }
            }
            Spacer(Modifier.height(1.dp).onGloballyPositioned { settingsSectionOffsets["People & access"] = it.positionInParent().y.roundToInt() })
            BeaconPeopleAccessPanel(
                api = api,
                sessionToken = currentSession.token,
                cameras = cameras,
                isAdmin = currentSession.householdRole == "owner" || currentSession.householdRole == "admin",
                onAuthorizationLost = expireSession,
            )
            Spacer(Modifier.height(1.dp).onGloballyPositioned { settingsSectionOffsets["Data & storage"] = it.positionInParent().y.roundToInt() })
            BeaconSectionHeader("Data & storage", "Choose how long motion metadata is kept.")
            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                Text("Motion history", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (motionRetentionDays == null) {
                    Text("Loading retention setting…", modifier = Modifier.padding(top = 12.dp))
                } else {
                    Text("Keep motion history for", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 14.dp, bottom = 8.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        listOf(1, 7, 30, 90).chunked(2).forEach { options ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                options.forEach { days ->
                                    androidx.compose.material3.FilterChip(
                                        selected = motionRetentionDays == days,
                                        enabled = !savingMotionRetention,
                                        onClick = { motionRetentionDays = days },
                                        label = { Text(if (days == 1) "1 day" else "$days days") },
                                        modifier = Modifier.weight(1f),
                                        colors = androidx.compose.material3.FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                            selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                        ),
                                    )
                                }
                            }
                        }
                    }
                    Button(
                        enabled = !savingMotionRetention && motionRetentionDays != savedMotionRetentionDays,
                        onClick = {
                            val days = motionRetentionDays ?: return@Button
                            savingMotionRetention = true
                            scope.launch {
                                val result = withContext(Dispatchers.IO) { runCatching { api.setMotionRetention(currentSession.token, days) } }
                                result.onSuccess {
                                    motionRetentionDays = it
                                    savedMotionRetentionDays = it
                                    message = "Motion history setting saved."
                                }.onFailure { message = it.userFacingMessage("Motion history setting could not be saved") }
                                savingMotionRetention = false
                            }
                        },
                        modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                    ) { Text(if (savingMotionRetention) "Saving…" else "Save changes") }
                }
                BeaconGoogleDriveCard(
                    api = api,
                    sessionToken = currentSession.token,
                    onAuthorizationLost = expireSession,
                )
            }
            Spacer(Modifier.height(1.dp).onGloballyPositioned { settingsSectionOffsets["Security"] = it.positionInParent().y.roundToInt() })
            BeaconSectionHeader("Security", "Review signed-in devices and camera access.")
            BeaconSignedInDevicesPanel(
                api = api,
                sessionToken = currentSession.token,
                onAuthorizationLost = expireSession,
            )
            Text("Recent access", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 18.dp))
            if (!accessHistoryLoaded) Text("Loading…")
            if (accessHistoryLoaded && accessEvents.isEmpty()) {
                Text("No recent camera access.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (accessEvents.isNotEmpty()) {
                val pageSize = 5
                val pageCount = (accessEvents.size + pageSize - 1) / pageSize
                val page = accessHistoryPage.coerceIn(0, pageCount - 1)
                accessEvents.drop(page * pageSize).take(pageSize).forEach { event ->
                    AccessEventRow(event, currentSession.email)
                }
                if (pageCount > 1) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        androidx.compose.material3.TextButton(
                            enabled = page > 0,
                            onClick = { accessHistoryPage = page - 1 },
                        ) { Text("Previous") }
                        Text("Page ${page + 1} of $pageCount", style = MaterialTheme.typography.labelLarge)
                        androidx.compose.material3.TextButton(
                            enabled = page < pageCount - 1,
                            onClick = { accessHistoryPage = page + 1 },
                        ) { Text("Next") }
                    }
                }
            }
            Spacer(Modifier.height(1.dp).onGloballyPositioned { settingsSectionOffsets["Account"] = it.positionInParent().y.roundToInt() })
            BeaconSectionHeader("Account", "Manage your signed-in session and data.")
            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                BeaconAccountProfileCard(
                    api = api,
                    sessionToken = currentSession.token,
                    onAuthorizationLost = expireSession,
                )
            }
            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                Text("Delete account", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "Permanently removes your Beacon account, data and access.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedButton(
                    onClick = {
                        deleteAccountError = ""
                        deleteAccountOpen = true
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text("Delete account") }
            }
            Spacer(Modifier.height(1.dp).onGloballyPositioned { settingsSectionOffsets["Privacy"] = it.positionInParent().y.roundToInt() })
            BeaconSectionHeader("Privacy", "Understand the data Beacon keeps and where to find the full details.")
            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                Text("Your privacy defaults", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "The important parts are summarized here. Full technical details remain on Trust & privacy.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Column(
                    modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    BeaconPrivacyFact("Motion history", "Event time, camera and motion metadata follow your retention setting.")
                    BeaconPrivacyFact("Security activity", "Session and access history is shown without a device fingerprint.")
                    BeaconPrivacyFact("Cloud storage", "Google Drive is optional and recording is controlled separately.")
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Trust & privacy", fontWeight = FontWeight.Bold)
                        Text(
                            "Capture, sharing, retention and account-data details.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    OutlinedButton(
                        onClick = {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${BuildConfig.BEACON_WEB_URL.trimEnd('/')}/trust")))
                        },
                    ) { Text("View details") }
                }
            }
    }
}
