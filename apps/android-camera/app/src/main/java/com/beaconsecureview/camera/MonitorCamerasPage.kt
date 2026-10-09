package com.beaconsecureview.camera

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun ColumnScope.MonitorCamerasPage(
    state: MonitorHomeState,
    currentSession: BeaconApi.AccountSession,
) {
    with(state) {
            val settingsSources =
                selectedSettingsDeviceId?.let { deviceId ->
                    cameras.filter { it.deviceId == deviceId }
                }.orEmpty()
            if (selectedSettingsDeviceId != null && settingsSources.isNotEmpty()) {
                MonitorDeviceSettings(
                    api = api,
                    sessionToken = currentSession.token,
                    device = devices.find { it.id == selectedSettingsDeviceId },
                    sources = settingsSources,
                    canManageSettings = currentSession.householdRole in setOf("owner", "admin"),
                    busy = deviceControlBusy,
                    onBack = { selectedSettingsDeviceId = null },
                    onView = { selectedCameraId = it.id },
                    onActivate = { target ->
                        deviceControlBusy = true
                        scope.launch {
                            val result =
                                withContext(Dispatchers.IO) {
                                    runCatching { api.activateCamera(currentSession.token, target.id) }
                                }
                            result.onSuccess {
                                delay(650)
                                refresh(currentSession.token, showLoading = false)
                                message = "${target.name} is now active."
                            }.onFailure {
                                message = it.userFacingMessage("Could not switch camera")
                            }
                            deviceControlBusy = false
                        }
                    },
                    onPrivacyChange = { enabled ->
                        val deviceId = settingsSources.first().deviceId
                        deviceControlBusy = true
                        scope.launch {
                            val result =
                                withContext(Dispatchers.IO) {
                                    runCatching {
                                        api.setDevicePrivacy(currentSession.token, deviceId, enabled)
                                    }
                                }
                            result.onSuccess {
                                delay(400)
                                refresh(currentSession.token, showLoading = false)
                                message =
                                    if (enabled) "Privacy mode enabled. Capture stopped."
                                    else "Privacy mode disabled. Camera available again."
                            }.onFailure {
                                message = it.userFacingMessage("Could not change privacy mode")
                            }
                            deviceControlBusy = false
                        }
                    },
                    onAuthorizationLost = expireSession,
                    onChanged = { refresh(currentSession.token, showLoading = false) },
                    motionContent = {
                        if (currentSession.householdRole in setOf("owner", "admin")) {
                            AndroidMotionSettingsPanel(
                                sources = settingsSources,
                                settings = cameraMotionSettings,
                                loaded = cameraMotionSettingsLoaded,
                                busy = cameraMotionSettingsBusy,
                                error = cameraMotionSettingsError,
                                notice = cameraMotionSettingsNotice,
                                onChange = { changed ->
                                    cameraMotionSettings =
                                        cameraMotionSettings.map { if (it.cameraId == changed.cameraId) changed else it }
                                    cameraMotionSettingsError = ""
                                    cameraMotionSettingsNotice = ""
                                },
                                onSave = { changed ->
                                    cameraMotionSettingsBusy = true
                                    cameraMotionSettingsError = ""
                                    cameraMotionSettingsNotice = ""
                                    scope.launch {
                                        val result =
                                            withContext(Dispatchers.IO) {
                                                runCatching { api.updateMonitorMotionSettings(currentSession.token, changed) }
                                            }
                                        result.onSuccess { saved ->
                                            cameraMotionSettings =
                                                cameraMotionSettings.map { if (it.cameraId == saved.cameraId) saved else it }
                                            cameraMotionSettingsNotice =
                                                "Saved. Your phone applies the settings on its next connection check."
                                        }.onFailure {
                                            if (it is AuthorizationLostException) {
                                                expireSession()
                                            } else {
                                                cameraMotionSettingsError =
                                                    it.userFacingMessage("Changes could not be saved. Your edits are still here to retry.")
                                            }
                                        }
                                        cameraMotionSettingsBusy = false
                                    }
                                },
                                onRetry = {
                                    val deviceId = settingsSources.first().deviceId
                                    cameraMotionSettingsLoaded = false
                                    cameraMotionSettingsError = ""
                                    scope.launch {
                                        val result =
                                            withContext(Dispatchers.IO) {
                                                runCatching { api.monitorMotionSettings(currentSession.token, deviceId) }
                                            }
                                        result.onSuccess { cameraMotionSettings = it }
                                            .onFailure {
                                                if (it is AuthorizationLostException) {
                                                    expireSession()
                                                } else {
                                                    cameraMotionSettingsError =
                                                        it.userFacingMessage("Motion settings could not be loaded. Try again.")
                                                }
                                            }
                                        cameraMotionSettingsLoaded = true
                                    }
                                },
                            )
                        }
                    },
                )
            } else {
                if (busy) Text("Loading cameras…")
                if (!busy && orderedCameras.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxWidth().heightIn(min = 116.dp)
                            .beaconDashedBorder(MaterialTheme.colorScheme.outlineVariant, 12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("No cameras yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else if (!busy) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        OutlinedTextField(
                            value = cameraCatalogQuery,
                            onValueChange = { cameraCatalogQuery = it },
                            modifier = Modifier.fillMaxWidth(),
                            placeholder = { Text("Find a camera or device") },
                            leadingIcon = { Icon(Icons.Outlined.Search, null) },
                            singleLine = true,
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            CameraCatalogFilter.entries.forEach { filterOption ->
                                val count = orderedCameras.count { cameraCatalogMatchesFilter(it, filterOption) }
                                androidx.compose.material3.FilterChip(
                                    selected = cameraCatalogFilter == filterOption,
                                    onClick = { cameraCatalogFilter = filterOption },
                                    label = { Text("${filterOption.label} $count") },
                                    colors = androidx.compose.material3.FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                        selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                    ),
                                )
                            }
                        }
                        val visibleCameras = cameraCatalogVisible(orderedCameras, cameraCatalogFilter, cameraCatalogQuery)
                        Text(
                            cameraCatalogResultsMessage(cameraCatalogQuery, visibleCameras.size, orderedCameras.size),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (visibleCameras.isEmpty()) {
                            BeaconPanel(modifier = Modifier.fillMaxWidth()) {
                                Column(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                ) {
                                    Text("No matching cameras", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                    Text(
                                        "Try another name or choose a different status.",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    OutlinedButton(
                                        onClick = {
                                            cameraCatalogQuery = ""
                                            cameraCatalogFilter = CameraCatalogFilter.All
                                        },
                                        modifier = Modifier.padding(top = 12.dp),
                                    ) { Text("Clear filters") }
                                }
                            }
                        } else {
                            MonitorCameraGrid(
                                cameras = visibleCameras,
                                onView = { selectedCameraId = it.id },
                                onSettings = { selectedSettingsDeviceId = it.deviceId },
                            )
                        }
                    }
                }
            }
    }
}
