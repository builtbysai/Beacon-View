package com.beaconsecureview.camera

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun ColumnScope.MonitorHomePage(
    state: MonitorHomeState,
    currentSession: BeaconApi.AccountSession,
) {
    with(state) {
            val isHouseholdManager = currentSession.householdRole == "owner" || currentSession.householdRole == "admin"
            val hostCameras = monitorHostCameras(cameras)
            if (cameras.isEmpty() && busy) {
                // Still loading: saying "nothing shared with you" now would be wrong for an owner.
                Text("Loading cameras…", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (cameras.isEmpty()) {
                val loadFailed = message.startsWith("Cameras are temporarily unavailable.")
                Box(
                    modifier = Modifier.fillMaxWidth()
                        .heightIn(min = 520.dp)
                        .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(BeaconRadii.Lg))
                        .beaconDashedBorder(MaterialTheme.colorScheme.outlineVariant, BeaconRadii.Lg)
                        .padding(28.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Xl),
                    ) {
                        Text(
                            if (loadFailed) "Cameras are temporarily unavailable"
                            else if (isHouseholdManager) "Add your first device"
                            else if (currentSession.householdRole == null) "No cameras yet"
                            else "No cameras shared with you yet",
                            fontSize = 24.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = MaterialTheme.colorScheme.onSurface,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                        Text(
                            if (loadFailed) message.removePrefix("Cameras are temporarily unavailable. ")
                            else if (isHouseholdManager) "Turn a spare phone, tablet, or computer into a camera."
                            else if (currentSession.householdRole == null) "Cameras you add, or that are shared with you, appear here."
                            else "Ask the household owner or an admin to grant you access to a camera from Settings → Household sharing.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                        if (loadFailed) {
                            OutlinedButton(onClick = { refresh(currentSession.token) }) { Text("Retry") }
                        } else if (isHouseholdManager) {
                            Button(
                                onClick = { addCameraChoiceOpen = true },
                                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface),
                                shape = RoundedCornerShape(BeaconRadii.Md),
                            ) {
                                Icon(Icons.Outlined.Add, null, modifier = Modifier.size(18.dp))
                                Text("Add device", modifier = Modifier.padding(start = 6.dp), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            } else {
                // Mirrors the PWA's home-welcome: a plain h2 greeting plus a
                // small secondary-colored subtitle -- no card, no background.
                Text(homeGreeting(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    homeSubtitle(hostCameras),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
                val attentionCameras = homeAttentionCameras(hostCameras)
                if (attentionCameras.isNotEmpty()) {
                    BeaconPanel(modifier = Modifier.fillMaxWidth().padding(top = BeaconSpacing.Lg)) {
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                            Icon(Icons.Outlined.Warning, null, tint = BeaconWarning)
                            Text(homeAttentionTitle(attentionCameras), fontWeight = FontWeight.Bold)
                            Text(homeAttentionDescription(attentionCameras), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            androidx.compose.material3.TextButton(onClick = {
                                if (attentionCameras.size == 1) selectedSettingsDeviceId = attentionCameras[0].deviceId
                                monitorPage = MonitorPage.Cameras
                            }) {
                                Text(if (attentionCameras.size == 1 && attentionCameras[0].needsPairing)
                                    "Reconnect ${attentionCameras[0].deviceName} →"
                                else if (attentionCameras.size == 1) "Check status →"
                                else "Review ${attentionCameras.size} cameras →")
                            }
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = BeaconSpacing.Xl),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Favorites", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    androidx.compose.material3.TextButton(onClick = { favoritesEditorOpen = true }) { Text("Edit") }
                }
                val favoriteCameras = homeFavoriteCameras(hostCameras, favoriteCameraIds, hasSavedFavorites)
                if (favoriteCameras.isEmpty()) {
                    Column(
                        modifier =
                            Modifier.fillMaxWidth()
                                .beaconDashedBorder(MaterialTheme.colorScheme.outlineVariant, BeaconRadii.Lg)
                                .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(BeaconRadii.Lg))
                                .padding(BeaconSpacing.Xxl),
                        verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Md),
                    ) {
                        Text("No favorites chosen yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        OutlinedButton(onClick = { favoritesEditorOpen = true }) { Text("Choose favorites") }
                    }
                } else {
                    MonitorCameraGrid(
                        cameras = favoriteCameras,
                        onView = { selectedCameraId = it.id },
                        onSettings = {
                            selectedSettingsDeviceId = it.deviceId
                            monitorPage = MonitorPage.Cameras
                        },
                        onRemoveFavorite = { camera ->
                            val currentIds = if (hasSavedFavorites) favoriteCameraIds
                                else favoriteCameras.map { it.id }.toSet()
                            val updated = currentIds - camera.id
                            favoritesStore.replace(currentSession.userId, updated)
                            favoriteCameraIds = updated
                            hasSavedFavorites = true
                        },
                    )
                }
                androidx.compose.material3.TextButton(
                    onClick = { monitorPage = MonitorPage.Cameras },
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                ) { Text("View all ${hostCameras.size} device${if (hostCameras.size == 1) "" else "s"} →") }
            }
            if (cameras.isNotEmpty()) BeaconPanel(modifier = Modifier.fillMaxWidth().padding(top = BeaconSpacing.Lg)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Latest activity", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    androidx.compose.material3.TextButton(onClick = {
                        monitorPage = MonitorPage.Events
                        eventsView = MonitorEventsView.Activity
                    }) {
                        Text("See all")
                    }
                }
                when {
                    !motionEventsLoaded -> Text("Loading activity…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    motionEvents.isEmpty() -> Text(
                        "No recent activity.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(vertical = BeaconSpacing.Xxl),
                    )
                    else -> motionEvents.take(3).forEach { event -> MotionEventPreviewRow(event) }
                }
                androidx.compose.material3.TextButton(
                    onClick = {
                        monitorPage = MonitorPage.Events
                        eventsView = MonitorEventsView.Activity
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Open Activity") }
            }
            if (favoritesEditorOpen) {
                MonitorFavoritesEditor(
                    cameras = hostCameras,
                    selectedIds = if (hasSavedFavorites) favoriteCameraIds
                        else homeFavoriteCameras(hostCameras, favoriteCameraIds).map { it.id }.toSet(),
                    onToggle = { cameraId ->
                        val currentIds = if (hasSavedFavorites) favoriteCameraIds
                            else homeFavoriteCameras(hostCameras, favoriteCameraIds).map { it.id }.toSet()
                        val updated = toggledFavoriteIds(currentIds, cameraId)
                        favoritesStore.replace(currentSession.userId, updated)
                        favoriteCameraIds = updated
                        hasSavedFavorites = true
                    },
                    onDismiss = { favoritesEditorOpen = false },
                )
            }
    }
}
