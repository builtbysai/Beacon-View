package com.beaconsecureview.camera

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/** One row of the live view's More sheet. */
internal data class LiveMoreAction(
    val icon: ImageVector,
    val label: String,
    val value: String? = null,
    val enabled: Boolean = true,
    /** Keeps the sheet open, for rows that reveal something inside it. */
    val keepOpen: Boolean = false,
    val onClick: () -> Unit,
)

/**
 * The live view's secondary controls. The bar itself keeps Audio, Talk, Record and More, so the
 * picture is not covered by a long row of buttons (ADR 0107). [details] is shown under the rows
 * once a row such as "Stream details" has been opened.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LiveViewMoreSheet(
    actions: List<LiveMoreAction>,
    onDismiss: () -> Unit,
    details: (@Composable () -> Unit)? = null,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier =
                Modifier.fillMaxWidth()
                    .heightIn(max = 520.dp)
                    .verticalScroll(rememberScrollState())
                    .navigationBarsPadding()
                    .padding(bottom = 12.dp),
        ) {
            actions.forEach { action ->
                Row(
                    modifier =
                        Modifier.fillMaxWidth()
                            .clickable(enabled = action.enabled, role = Role.Button) {
                                action.onClick()
                                if (!action.keepOpen) onDismiss()
                            }
                            .padding(horizontal = 24.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val tint =
                        if (action.enabled) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
                    Icon(action.icon, contentDescription = null, tint = tint)
                    Text(
                        action.label,
                        color = tint,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f),
                    )
                    action.value?.let {
                        Text(
                            it,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
            details?.let {
                Column(modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)) { it() }
            }
        }
    }
}
