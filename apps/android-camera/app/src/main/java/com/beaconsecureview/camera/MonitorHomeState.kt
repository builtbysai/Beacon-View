package com.beaconsecureview.camera

import android.content.Context
import android.content.SharedPreferences
import androidx.activity.compose.ManagedActivityResultLauncher
import androidx.compose.foundation.ScrollState
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import kotlinx.coroutines.CoroutineScope

/**
 * Everything a Monitor page reads or changes (ADR 0096). `MonitorHome` owns the remembered state
 * and the effects; this wraps them so each page is its own composable in its own file. Properties
 * keep the names the page bodies always used.
 */
internal class MonitorHomeState(
    val context: Context,
    val scope: CoroutineScope,
    val api: BeaconApi,
    val sessionStore: AccountSessionStore,
    val favoritesStore: CameraFavoritesStore,
    val orderStore: CameraOrderStore,
    val monitorScrollState: ScrollState,
    val settingsSectionOffsets: SnapshotStateMap<String, Int>,
    val settingsSections: List<String>,
    val navigationPreferences: SharedPreferences,
    val alertPermissionLauncher: ManagedActivityResultLauncher<String, Boolean>,
    val onCameraMode: () -> Unit,
    val onSetUpThisDevice: (String) -> Unit,
    val onAccountDeleted: () -> Unit,
    val themePreference: BeaconThemePreference,
    val onThemePreferenceChange: (BeaconThemePreference) -> Unit,
    val expireSession: () -> Unit,
    val enableNotifications: () -> Unit,
    private val refreshCameras: (String, Boolean) -> Unit,
    sessionState: MutableState<BeaconApi.AccountSession?>,
    emailState: MutableState<String>,
    passwordState: MutableState<String>,
    showPasswordState: MutableState<Boolean>,
    googleSignInAvailableState: MutableState<Boolean>,
    camerasState: MutableState<List<BeaconApi.MonitorCamera>>,
    devicesState: MutableState<List<BeaconApi.Device>>,
    selectedCameraIdState: MutableState<String?>,
    selectedSettingsDeviceIdState: MutableState<String?>,
    addCameraChoiceOpenState: MutableState<Boolean>,
    pairAnotherDeviceOpenState: MutableState<Boolean>,
    favoriteCameraIdsState: MutableState<Set<String>>,
    hasSavedFavoritesState: MutableState<Boolean>,
    favoritesEditorOpenState: MutableState<Boolean>,
    cameraOrderIdsState: MutableState<List<String>>,
    cameraCatalogQueryState: MutableState<String>,
    cameraCatalogFilterState: MutableState<CameraCatalogFilter>,
    monitorPageState: MutableState<MonitorPage>,
    eventsViewState: MutableState<MonitorEventsView>,
    navigationOpenState: MutableState<Boolean>,
    householdState: MutableState<BeaconApi.HouseholdSummary?>,
    accessEventsState: MutableState<List<BeaconApi.AccessEvent>>,
    accessHistoryLoadedState: MutableState<Boolean>,
    accessHistoryPageState: MutableState<Int>,
    motionRetentionDaysState: MutableState<Int?>,
    savedMotionRetentionDaysState: MutableState<Int?>,
    savingMotionRetentionState: MutableState<Boolean>,
    deviceControlBusyState: MutableState<Boolean>,
    deleteAccountOpenState: MutableState<Boolean>,
    deletingAccountState: MutableState<Boolean>,
    deleteAccountErrorState: MutableState<String>,
    motionEventsState: MutableState<List<BeaconApi.MotionEvent>>,
    motionEventsLoadedState: MutableState<Boolean>,
    cameraMotionSettingsState: MutableState<List<BeaconApi.CameraMotionSettings>>,
    cameraMotionSettingsLoadedState: MutableState<Boolean>,
    cameraMotionSettingsBusyState: MutableState<Boolean>,
    cameraMotionSettingsErrorState: MutableState<String>,
    cameraMotionSettingsNoticeState: MutableState<String>,
    recordingsState: MutableState<List<BeaconApi.RecordingSummary>>,
    recordingsLoadedState: MutableState<Boolean>,
    recordingsCursorState: MutableState<String?>,
    recordingBusyIdState: MutableState<String?>,
    recordingsLoadingMoreState: MutableState<Boolean>,
    recordingPlaybackState: MutableState<BeaconApi.PlaybackRecording?>,
    recordingDeleteTargetState: MutableState<BeaconApi.RecordingSummary?>,
    recordingShareTargetState: MutableState<BeaconApi.RecordingSummary?>,
    messageState: MutableState<String>,
    busyState: MutableState<Boolean>,
    notificationConsentState: MutableState<Boolean>,
    notificationBusyState: MutableState<Boolean>,
    notificationPreferencesState: MutableState<List<BeaconApi.NotificationPreference>>,
) {
    var session: BeaconApi.AccountSession? by sessionState
    var email: String by emailState
    var password: String by passwordState
    var showPassword: Boolean by showPasswordState
    var googleSignInAvailable: Boolean by googleSignInAvailableState
    var cameras: List<BeaconApi.MonitorCamera> by camerasState
    var devices: List<BeaconApi.Device> by devicesState
    var selectedCameraId: String? by selectedCameraIdState
    var selectedSettingsDeviceId: String? by selectedSettingsDeviceIdState
    var addCameraChoiceOpen: Boolean by addCameraChoiceOpenState
    var pairAnotherDeviceOpen: Boolean by pairAnotherDeviceOpenState
    var favoriteCameraIds: Set<String> by favoriteCameraIdsState
    var hasSavedFavorites: Boolean by hasSavedFavoritesState
    var favoritesEditorOpen: Boolean by favoritesEditorOpenState
    var cameraOrderIds: List<String> by cameraOrderIdsState
    var cameraCatalogQuery: String by cameraCatalogQueryState
    var cameraCatalogFilter: CameraCatalogFilter by cameraCatalogFilterState
    var monitorPage: MonitorPage by monitorPageState
    var eventsView: MonitorEventsView by eventsViewState
    var navigationOpen: Boolean by navigationOpenState
    var household: BeaconApi.HouseholdSummary? by householdState
    var accessEvents: List<BeaconApi.AccessEvent> by accessEventsState
    var accessHistoryLoaded: Boolean by accessHistoryLoadedState
    var accessHistoryPage: Int by accessHistoryPageState
    var motionRetentionDays: Int? by motionRetentionDaysState
    var savedMotionRetentionDays: Int? by savedMotionRetentionDaysState
    var savingMotionRetention: Boolean by savingMotionRetentionState
    var deviceControlBusy: Boolean by deviceControlBusyState
    var deleteAccountOpen: Boolean by deleteAccountOpenState
    var deletingAccount: Boolean by deletingAccountState
    var deleteAccountError: String by deleteAccountErrorState
    var motionEvents: List<BeaconApi.MotionEvent> by motionEventsState
    var motionEventsLoaded: Boolean by motionEventsLoadedState
    var cameraMotionSettings: List<BeaconApi.CameraMotionSettings> by cameraMotionSettingsState
    var cameraMotionSettingsLoaded: Boolean by cameraMotionSettingsLoadedState
    var cameraMotionSettingsBusy: Boolean by cameraMotionSettingsBusyState
    var cameraMotionSettingsError: String by cameraMotionSettingsErrorState
    var cameraMotionSettingsNotice: String by cameraMotionSettingsNoticeState
    var recordings: List<BeaconApi.RecordingSummary> by recordingsState
    var recordingsLoaded: Boolean by recordingsLoadedState
    var recordingsCursor: String? by recordingsCursorState
    var recordingBusyId: String? by recordingBusyIdState
    var recordingsLoadingMore: Boolean by recordingsLoadingMoreState
    var recordingPlayback: BeaconApi.PlaybackRecording? by recordingPlaybackState
    var recordingDeleteTarget: BeaconApi.RecordingSummary? by recordingDeleteTargetState
    var recordingShareTarget: BeaconApi.RecordingSummary? by recordingShareTargetState
    var message: String by messageState
    var busy: Boolean by busyState
    var notificationConsent: Boolean by notificationConsentState
    var notificationBusy: Boolean by notificationBusyState
    var notificationPreferences: List<BeaconApi.NotificationPreference> by notificationPreferencesState

    /** Host cameras in the person's chosen order. */
    val orderedCameras: List<BeaconApi.MonitorCamera>
        get() {
            val order = cameraOrderIds.withIndex().associate { it.value to it.index }
            return monitorHostCameras(cameras).sortedBy { order[it.id] ?: Int.MAX_VALUE }
        }

    fun refresh(token: String, showLoading: Boolean = cameras.isEmpty()) = refreshCameras(token, showLoading)
}
