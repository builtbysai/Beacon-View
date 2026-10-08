package com.beaconsecureview.camera

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Mirrors the PWA's AddCameraPage.tsx: choosing how a device joins Beacon
 * is a real, two-option decision ("Pair another device" vs "Use this
 * device"), not something Android should skip straight past. Android had
 * no "pair another device" path at all before this -- "Add camera" always
 * self-paired the current phone, the `onUseBrowser` equivalent. */
@Composable
internal fun BeaconAddCameraChoiceDialog(
    onDismiss: () -> Unit,
    onPairAnotherDevice: () -> Unit,
    onUseThisDevice: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add a device") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Md)) {
                Text(
                    "Choose how this device will join Beacon. Start with a dedicated Android device, or turn the device you're using now into a temporary camera.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Surface(
                    onClick = onPairAnotherDevice,
                    shape = RoundedCornerShape(BeaconRadii.Lg),
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Column(modifier = Modifier.padding(BeaconSpacing.Md)) {
                        Text(
                            "RECOMMENDED",
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                            Icon(Icons.Outlined.Phone, null, tint = MaterialTheme.colorScheme.primary)
                            Text("Pair another device", fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
                        }
                        Text(
                            "Connect an Android phone or tablet running Beacon. Designed for ongoing monitoring.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
                Surface(
                    onClick = onUseThisDevice,
                    shape = RoundedCornerShape(BeaconRadii.Lg),
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    color = MaterialTheme.colorScheme.surface,
                ) {
                    Column(modifier = Modifier.padding(BeaconSpacing.Md)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Smartphone, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Use this device", fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
                        }
                        Text(
                            "Use a camera available on the device you're using right now. Best for temporary monitoring.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
                BeaconTrustLine("Only connect or use devices you own or are authorized to access.")
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Renders a scannable QR bitmap for [content] using ZXing's encoder
 * directly -- play-services-code-scanner (already in this app) only
 * *reads* barcodes, it has no writer. */
private fun generateQrBitmap(content: String, sizePx: Int): Bitmap {
    val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, sizePx, sizePx)
    val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.RGB_565)
    for (x in 0 until sizePx) {
        for (y in 0 until sizePx) {
            bitmap.setPixel(x, y, if (matrix.get(x, y)) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }
    }
    return bitmap
}

/** Mirrors the PWA's PairingDialog.tsx for the non-reconnect ("Add device")
 * case: generates a one-time code on open, shows it as both a QR (scannable
 * by the other device's own "Scan and connect" pairing screen) and plain
 * text, with a copyable setup link for sharing to a device that isn't in
 * the room. Unlike the PWA, this doesn't auto-detect completion via a
 * household websocket event -- there's no live household-event feed wired
 * into Android's monitor session to react to yet, so the user dismisses it
 * manually once the other device is paired, matching the simpler pattern
 * already used for the Reconnect dialog. */
@Composable
internal fun BeaconPairAnotherDeviceDialog(
    api: BeaconApi,
    sessionToken: String,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var code by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }

    fun createCode() {
        busy = true
        error = ""
        code = null
        scope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { api.createPairingCode(sessionToken) } }
            result.onSuccess { code = it }.onFailure { error = it.userFacingMessage("Beacon could not prepare camera setup") }
            busy = false
        }
    }

    LaunchedEffect(Unit) { createCode() }

    val setupLink = code?.let { "${BuildConfig.BEACON_API_URL.trimEnd('/')}/pair?code=$it" }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Pair another device") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Md)) {
                when {
                    busy && code == null -> Text("Preparing…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    error.isNotBlank() -> {
                        Text("Couldn't prepare pairing code", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                        Text(error, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                    }
                    code != null && setupLink != null -> {
                        Text(
                            "Open this one-time setup link on an Android device with a camera.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                        val qrBitmap = remember(setupLink) { runCatching { generateQrBitmap(setupLink, 480) }.getOrNull() }
                        qrBitmap?.let {
                            Image(it.asImageBitmap(), contentDescription = "Beacon pairing QR code", modifier = Modifier.size(180.dp))
                        }
                        Text("ONE-TIME PAIRING CODE", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(code!!, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
                        Text("Expires in 10 minutes", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(onClick = { clipboard.setText(AnnotatedString(setupLink)); copied = true }) {
                            Text(if (copied) "Copied" else "Copy setup link")
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (error.isNotBlank()) {
                Button(onClick = { createCode() }) { Text("Try again") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(if (code != null) "Done" else "Cancel") } },
    )
}
