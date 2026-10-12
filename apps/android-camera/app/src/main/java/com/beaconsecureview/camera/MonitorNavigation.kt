package com.beaconsecureview.camera

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForwardIos
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Button
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

internal enum class MonitorPage { Home, Cameras, Events, Settings }
internal enum class MonitorEventsView { Activity, Clips }

@Composable
internal fun BeaconEventsViewSwitch(
    selected: MonitorEventsView,
    onSelect: (MonitorEventsView) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(11.dp),
    ) {
        Row(modifier = Modifier.padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            listOf(MonitorEventsView.Activity to "Activity", MonitorEventsView.Clips to "Clips").forEach { (view, label) ->
                val active = selected == view
                TextButton(
                    onClick = { onSelect(view) },
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics { this.selected = active },
                    colors =
                        ButtonDefaults.textButtonColors(
                            containerColor = if (active) MaterialTheme.colorScheme.surface else Color.Transparent,
                            contentColor = if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    shape = RoundedCornerShape(BeaconRadii.Md),
                ) {
                    Text(label, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
internal fun BeaconMonitorTopBar(onOpenNavigation: () -> Unit, onAddCamera: (() -> Unit)?) {
    val compactAction = LocalConfiguration.current.screenWidthDp < 360
    Column {
        Surface(color = MaterialTheme.colorScheme.background.copy(alpha = 0.97f)) {
            Row(
                modifier =
                    Modifier.fillMaxWidth()
                        .statusBarsPadding()
                        .height(54.dp)
                        .padding(start = BeaconSpacing.Sm, end = BeaconSpacing.Md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onOpenNavigation) {
                    Icon(Icons.Outlined.Menu, "Open menu")
                }
                Icon(Icons.Outlined.Videocam, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
                Text(
                    "Beacon",
                    modifier = Modifier.padding(start = BeaconSpacing.Xs).weight(1f),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (onAddCamera != null) {
                    Button(
                        onClick = onAddCamera,
                        modifier = Modifier.heightIn(min = 40.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface),
                        shape = RoundedCornerShape(BeaconRadii.Md),
                    ) {
                        Icon(Icons.Outlined.Add, null, modifier = Modifier.size(18.dp))
                        Text(if (compactAction) "Add" else "Add device", modifier = Modifier.padding(start = BeaconSpacing.Xs), fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}

/**
 * Minimum width, in dp, at which Beacon switches from the PWA's mobile
 * drawer navigation to its wide/desktop persistent sidebar. 600dp is
 * Android's own conventional phone/tablet breakpoint (Material Design
 * window-size guidance), and lands close to the PWA's own tablet breakpoint.
 */
internal const val BEACON_WIDE_LAYOUT_MIN_WIDTH_DP = 600

@Composable
internal fun BeaconMonitorNavigation(
    open: Boolean,
    selected: MonitorPage,
    email: String,
    themePreference: BeaconThemePreference,
    onDismiss: () -> Unit,
    onSelect: (MonitorPage) -> Unit,
    onThemePreferenceChange: (BeaconThemePreference) -> Unit,
    onTrustAndPrivacy: () -> Unit,
    onLogout: () -> Unit,
) {
    if (!open) return

    Box(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier =
                Modifier.fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.4f))
                    .clickable(role = Role.Button, onClickLabel = "Close menu", onClick = onDismiss),
        )
        Surface(
            modifier = Modifier.fillMaxHeight().width(280.dp),
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 18.dp,
        ) {
            BeaconSidebarContent(
                selected = selected,
                email = email,
                themePreference = themePreference,
                onSelect = { onSelect(it); onDismiss() },
                onThemePreferenceChange = onThemePreferenceChange,
                onTrustAndPrivacy = onTrustAndPrivacy,
                onLogout = onLogout,
                onCloseButtonClick = onDismiss,
            )
        }
    }
}

/**
 * The PWA's wide/desktop layout keeps its sidebar permanently visible beside
 * the page content instead of behind a drawer. This is that behavior's
 * Android equivalent, shown once the window is at least
 * [BEACON_WIDE_LAYOUT_MIN_WIDTH_DP] wide (tablets, unfolded foldables,
 * Chromebooks) -- see [BeaconMonitorNavigation] for the phone-width drawer.
 */
@Composable
internal fun BeaconPermanentSidebar(
    selected: MonitorPage,
    email: String,
    themePreference: BeaconThemePreference,
    onSelect: (MonitorPage) -> Unit,
    onThemePreferenceChange: (BeaconThemePreference) -> Unit,
    onTrustAndPrivacy: () -> Unit,
    onLogout: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxHeight().width(280.dp),
        color = MaterialTheme.colorScheme.surface,
    ) {
        BeaconSidebarContent(
            selected = selected,
            email = email,
            themePreference = themePreference,
            onSelect = onSelect,
            onThemePreferenceChange = onThemePreferenceChange,
            onTrustAndPrivacy = onTrustAndPrivacy,
            onLogout = onLogout,
            onCloseButtonClick = null,
        )
    }
}

/**
 * Shared nav-item list, account menu, and theme switcher rendered by both the
 * phone drawer ([BeaconMonitorNavigation]) and the wide-layout permanent
 * sidebar ([BeaconPermanentSidebar]). `onCloseButtonClick` is null for the
 * permanent sidebar, which has nothing to dismiss.
 */
@Composable
private fun BeaconSidebarContent(
    selected: MonitorPage,
    email: String,
    themePreference: BeaconThemePreference,
    onSelect: (MonitorPage) -> Unit,
    onThemePreferenceChange: (BeaconThemePreference) -> Unit,
    onTrustAndPrivacy: () -> Unit,
    onLogout: () -> Unit,
    onCloseButtonClick: (() -> Unit)?,
) {
    var accountMenuOpen by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().height(76.dp).padding(horizontal = BeaconSpacing.Lg),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            BeaconWordmark(compact = true)
            if (onCloseButtonClick != null) {
                IconButton(onClick = onCloseButtonClick) { Icon(Icons.Outlined.Close, "Close menu") }
            }
        }

        Column(
            modifier = Modifier.fillMaxWidth().weight(1f).padding(vertical = BeaconSpacing.Xxl),
            verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Xs),
        ) {
            listOf(
                Triple(MonitorPage.Home, "Home", Icons.Outlined.Home),
                Triple(MonitorPage.Cameras, "Cameras", Icons.Outlined.Videocam),
                Triple(MonitorPage.Events, "Activity", Icons.Outlined.Timeline),
                Triple(MonitorPage.Settings, "Settings", Icons.Outlined.Tune),
            ).forEach { (page, label, icon) ->
                BeaconSidebarButton(
                    label = label,
                    icon = icon,
                    selected = selected == page,
                    onClick = { onSelect(page) },
                )
            }
        }

        if (accountMenuOpen) {
            Surface(
                modifier = Modifier.fillMaxWidth().padding(horizontal = BeaconSpacing.Md, vertical = BeaconSpacing.Sm),
                shape = RoundedCornerShape(BeaconRadii.Md),
                border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                shadowElevation = 8.dp,
            ) {
                Column(modifier = Modifier.padding(BeaconSpacing.Sm), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(email, modifier = Modifier.padding(BeaconSpacing.Md), maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                    Text("Signed in", modifier = Modifier.padding(horizontal = BeaconSpacing.Md), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    HorizontalDivider(modifier = Modifier.padding(vertical = BeaconSpacing.Sm), color = MaterialTheme.colorScheme.outlineVariant)
                    Text("THEME", modifier = Modifier.padding(horizontal = BeaconSpacing.Md), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(BeaconRadii.Md)).padding(4.dp)) {
                        BeaconThemePreference.entries.forEach { preference ->
                            TextButton(
                                onClick = { onThemePreferenceChange(preference) },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.textButtonColors(
                                    containerColor = if (themePreference == preference) MaterialTheme.colorScheme.surface else Color.Transparent,
                                    contentColor = MaterialTheme.colorScheme.onSurface,
                                ),
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 2.dp),
                            ) { Text(preference.name, style = MaterialTheme.typography.labelSmall) }
                        }
                    }
                    TextButton(
                        onClick = onTrustAndPrivacy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Trust & privacy", modifier = Modifier.fillMaxWidth()) }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    TextButton(
                        onClick = onLogout,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) { Text("Sign out", modifier = Modifier.fillMaxWidth()) }
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        TextButton(
            onClick = { accountMenuOpen = !accountMenuOpen },
            modifier = Modifier.fillMaxWidth().padding(horizontal = BeaconSpacing.Md, vertical = 14.dp),
            shape = RoundedCornerShape(BeaconRadii.Md),
        ) {
            Box(
                modifier = Modifier.size(36.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    email.firstOrNull()?.uppercase() ?: "B",
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    fontWeight = FontWeight.Bold,
                )
            }
            Text(
                email,
                modifier = Modifier.padding(start = BeaconSpacing.Md).weight(1f),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontWeight = FontWeight.SemiBold,
            )
            Icon(
                Icons.AutoMirrored.Outlined.ArrowForwardIos,
                null,
                modifier = Modifier.size(14.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun BeaconSidebarButton(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val background = if (selected) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent
    val content = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier =
            Modifier.fillMaxWidth()
                .heightIn(min = 48.dp)
                .background(background)
                .clickable(role = Role.Button, onClick = onClick)
                .semantics { this.selected = selected },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.width(3.dp).height(38.dp).background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent),
        )
        Icon(icon, null, modifier = Modifier.padding(start = 21.dp).size(21.dp), tint = content)
        Text(
            label,
            modifier = Modifier.padding(start = BeaconSpacing.Lg),
            color = content,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
        )
    }
}
