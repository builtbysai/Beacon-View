package com.beaconsecureview.camera

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
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

/** Mirrors the PWA's full AddCameraPage rather than presenting the choice as a modal. */
@Composable
internal fun BeaconAddCameraChoicePage(
    onDismiss: () -> Unit,
    onPairAnotherDevice: () -> Unit,
    onUseThisDevice: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        TextButton(onClick = onDismiss) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, modifier = Modifier.size(18.dp))
            Text("Back to Home", modifier = Modifier.padding(start = 6.dp), fontWeight = FontWeight.Bold)
        }
        Text("Add a device", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
        Text(
            "Choose how this device will join Beacon. Start with a dedicated Android device, or turn the device you're using now into a temporary camera.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Surface(
            shape = RoundedCornerShape(BeaconRadii.Lg),
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 1.dp,
        ) {
            Column(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                    Box(modifier = Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Phone, null, tint = MaterialTheme.colorScheme.primary)
                    }
                    Text("RECOMMENDED", color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                Text("Pair another device", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                Text("Connect an Android phone or tablet running Beacon. Designed for ongoing monitoring.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("More device types can be added here as Beacon expands.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                Button(onClick = onPairAnotherDevice, modifier = Modifier.fillMaxWidth().height(42.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface,
                        contentColor = MaterialTheme.colorScheme.surface), shape = RoundedCornerShape(8.dp)) {
                    Text("Pair a device", fontWeight = FontWeight.Bold)
                    Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, modifier = Modifier.padding(start = 6.dp).size(18.dp))
                }
            }
        }
        Surface(
            shape = RoundedCornerShape(BeaconRadii.Lg),
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 1.dp,
        ) {
            Column(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(modifier = Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Smartphone, null, tint = MaterialTheme.colorScheme.primary)
                }
                Text("Use this device", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                Text("Use a camera available on the device you're using right now. Best for temporary monitoring.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("No separate device required.", color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = onUseThisDevice, modifier = Modifier.fillMaxWidth().height(42.dp),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface)) {
                    Text("Use this device", fontWeight = FontWeight.Bold)
                    Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, modifier = Modifier.padding(start = 6.dp).size(18.dp))
                }
            }
        }
        BeaconTrustLine("Only connect or use devices you own or are authorized to access.")
    }
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

    val setupLink = code?.let { "${BuildConfig.BEACON_WEB_URL.trimEnd('/')}/pair?code=$it" }
    val browserCameraLink = code?.let { "${BuildConfig.BEACON_WEB_URL.trimEnd('/')}/camera-mode/setup?code=$it" }

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
                        if (browserCameraLink != null) {
                            OutlinedButton(onClick = { clipboard.setText(AnnotatedString(browserCameraLink)) }) {
                                Text("Copy browser camera link")
                            }
                            Text(
                                "Send the browser camera link to a device you own. It opens Camera Mode without signing in; the one-time code pairs it to your account.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                                textAlign = TextAlign.Center,
                            )
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
