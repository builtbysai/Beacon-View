package com.beaconsecureview.camera

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun ColumnScope.MonitorEventsPage(
    state: MonitorHomeState,
    currentSession: BeaconApi.AccountSession,
) {
    with(state) {
            BeaconEventsViewSwitch(selected = eventsView, onSelect = { eventsView = it })
            if (eventsView == MonitorEventsView.Activity) {
                val isAdmin = currentSession.householdRole == "owner" || currentSession.householdRole == "admin"
                BeaconActivityFeed(
                    api = api,
                    sessionToken = currentSession.token,
                    cameras = cameras,
                    includeHouseholdActivity = isAdmin,
                    canClearHistory = isAdmin,
                    onOpenCamera = { id -> selectedCameraId = id },
                    onViewClip = { eventsView = MonitorEventsView.Clips },
                    onAuthorizationLost = expireSession,
                )
            } else {
                AndroidRecordingLibrary(
                api = api,
                sessionToken = currentSession.token,
                cameras = cameras,
                recordings = recordings,
                loaded = recordingsLoaded,
                loadingMore = recordingsLoadingMore,
                nextCursor = recordingsCursor,
                busyRecordingId = recordingBusyId,
                canDelete = currentSession.householdRole == "owner",
                playback = recordingPlayback,
                deleteTarget = recordingDeleteTarget,
                shareTarget = recordingShareTarget,
                onRefresh = {
                    recordingsLoaded = false
                    scope.launch {
                        val result = withContext(Dispatchers.IO) { runCatching { api.recordings(currentSession.token) } }
                        result.onSuccess {
                            recordings = it.recordings
                            recordingsCursor = it.nextCursor
                            message = ""
                        }.onFailure { message = it.userFacingMessage("Clips are temporarily unavailable") }
                        recordingsLoaded = true
                    }
                },
                onLoadMore = {
                    val cursor = recordingsCursor ?: return@AndroidRecordingLibrary
                    recordingsLoadingMore = true
                    scope.launch {
                        val result = withContext(Dispatchers.IO) { runCatching { api.recordings(currentSession.token, cursor) } }
                        result.onSuccess {
                            recordings = recordings + it.recordings
                            recordingsCursor = it.nextCursor
                        }.onFailure { message = it.userFacingMessage("More clips could not be loaded") }
                        recordingsLoadingMore = false
                    }
                },
                onPlay = { recording ->
                    recordingPlayback?.file?.delete()
                    recordingPlayback = null
                    recordingBusyId = recording.id
                    scope.launch {
                        val result =
                            withContext(Dispatchers.IO) {
                                runCatching {
                                    api.downloadRecordingForPlayback(
                                        currentSession.token,
                                        recording.id,
                                        context.cacheDir,
                                    )
                                }
                            }
                        result.onSuccess { recordingPlayback = it }
                            .onFailure { message = it.userFacingMessage("Clip could not be played") }
                        recordingBusyId = null
                    }
                },
                onRequestDelete = { recordingDeleteTarget = it },
                onConfirmDelete = {
                    val target = recordingDeleteTarget ?: return@AndroidRecordingLibrary
                    recordingBusyId = target.id
                    scope.launch {
                        val result = withContext(Dispatchers.IO) { runCatching { api.deleteRecording(currentSession.token, target.id) } }
                        result.onSuccess {
                            recordings = recordings.filterNot { it.id == target.id }
                            recordingPlayback?.file?.delete()
                            recordingPlayback = null
                            recordingDeleteTarget = null
                        }.onFailure { message = it.userFacingMessage("Clip could not be deleted") }
                        recordingBusyId = null
                    }
                },
                onCancelDelete = { recordingDeleteTarget = null },
                onClosePlayback = {
                    recordingPlayback?.file?.delete()
                    recordingPlayback = null
                },
                onRequestShare = { recordingShareTarget = it },
                onDismissShare = { recordingShareTarget = null },
                )
            }
    }
}
