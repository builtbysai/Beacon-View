package com.beaconsecureview.camera

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/** Home's local favorite selector, equivalent to the web viewer's picker. */
@Composable
internal fun MonitorFavoritesEditor(
    cameras: List<BeaconApi.MonitorCamera>,
    selectedIds: Set<String>,
    onToggle: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit Favorites") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                Text("Choose the cameras you want quick access to from Home.")
                cameras.distinctBy { it.deviceId }.forEach { camera ->
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable { onToggle(camera.id) },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = camera.id in selectedIds, onCheckedChange = null)
                        Text(camera.deviceName)
                    }
                }
            }
        },
        confirmButton = { Button(onClick = onDismiss) { Text("Done") } },
    )
}
