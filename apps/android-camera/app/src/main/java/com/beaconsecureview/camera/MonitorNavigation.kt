package com.beaconsecureview.camera

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

internal enum class MonitorPage { Home, Cameras, Activity, Settings }

@Composable
internal fun BeaconMonitorNavigation(
    selected: MonitorPage,
    onSelect: (MonitorPage) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.97f),
        shadowElevation = 10.dp,
    ) {
        Row(
            modifier =
                Modifier.fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 6.dp, vertical = 5.dp),
        ) {
            listOf(
                Triple(MonitorPage.Home, "Home", Icons.Outlined.Home),
                Triple(MonitorPage.Cameras, "Cameras", Icons.Outlined.Videocam),
                Triple(MonitorPage.Activity, "Activity", Icons.Outlined.History),
                Triple(MonitorPage.Settings, "Settings", Icons.Outlined.Settings),
            ).forEach { (page, label, icon) ->
                BeaconNavButton(
                    label = label,
                    icon = icon,
                    selected = selected == page,
                    onClick = { onSelect(page) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun BeaconNavButton(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors =
        if (selected) {
            ButtonDefaults.textButtonColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.primary,
            )
        } else {
            ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    androidx.compose.material3.TextButton(
        onClick = onClick,
        modifier =
            modifier
                .height(58.dp)
                .semantics { this.selected = selected },
        colors = colors,
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Icon(icon, null, modifier = Modifier.size(21.dp))
            Text(label, style = MaterialTheme.typography.labelSmall, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium)
        }
    }
}
