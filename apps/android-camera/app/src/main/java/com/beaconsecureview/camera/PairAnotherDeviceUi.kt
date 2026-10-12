package com.beaconsecureview.camera

import android.content.Intent
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
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.TabletAndroid
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class AddDeviceKind(val title: String, val description: String) {
    ThisDevice("This device", "The one in your hands right now."),
    PhoneOrTablet("Phone or tablet", "A spare Android or iPhone, or an iPad."),
    Computer("Computer", "A spare Windows, Mac or Linux computer."),
}

/**
 * Add a device (ADR 0117), the same flow as the web app: one question first, "which device will be the
 * camera?", then the steps for that device. A computer, a phone and the phone in your hand are all just
 * devices; only the steps differ.
 */
@Composable
internal fun BeaconAddCameraChoicePage(
    onDismiss: () -> Unit,
    onPairAnotherDevice: () -> Unit,
    onUseThisDevice: () -> Unit,
) {
    var selected by remember { mutableStateOf<AddDeviceKind?>(null) }
    val context = LocalContext.current
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        TextButton(onClick = onDismiss, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 0.dp, vertical = 8.dp)) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, modifier = Modifier.size(18.dp))
            Text("Back to Home", modifier = Modifier.padding(start = 6.dp), fontWeight = FontWeight.Bold)
        }
        Text("Add a device", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
        Text(
            "Which device will be the camera? We'll walk you through the rest.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        AddDeviceKind.entries.forEach { kind ->
            val isSelected = selected == kind
            Surface(
                onClick = { selected = kind },
                shape = RoundedCornerShape(BeaconRadii.Lg),
                border =
                    androidx.compose.foundation.BorderStroke(
                        if (isSelected) 2.dp else 1.dp,
                        if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                    ),
                color = MaterialTheme.colorScheme.surface,
                modifier = Modifier.fillMaxWidth().semantics { role = Role.RadioButton; this.selected = isSelected },
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        when (kind) {
                            AddDeviceKind.Computer -> Icons.Outlined.Computer
                            AddDeviceKind.PhoneOrTablet -> Icons.Outlined.TabletAndroid
                            AddDeviceKind.ThisDevice -> Icons.Outlined.Smartphone
                        },
                        null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Column {
                        Text(kind.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                        Text(
                            kind.description,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
        when (selected) {
            AddDeviceKind.ThisDevice ->
                AddDevicePanel("Use this device as a camera") {
                    Text(
                        "Beacon uses this phone's camera while the camera screen is open, and shows a clear indicator whenever it is on.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Button(onClick = onUseThisDevice, modifier = Modifier.fillMaxWidth().height(44.dp)) {
                        Text("Start the camera", fontWeight = FontWeight.Bold)
                    }
                }
            AddDeviceKind.PhoneOrTablet ->
                AddDevicePanel("Pair another phone or tablet") {
                    Text(
                        "Install Beacon on it (Android: from your Beacon website's downloads page; iPhone or iPad: open the setup link in Safari), then pair it with a one-time code.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Button(onClick = onPairAnotherDevice, modifier = Modifier.fillMaxWidth().height(44.dp)) {
                        Text("Show a pairing code", fontWeight = FontWeight.Bold)
                    }
                }
            AddDeviceKind.Computer ->
                AddDevicePanel("Set up a computer") {
                    Text(
                        "A computer is set up from the computer: open Beacon on it, sign in, then choose Add a device and Computer. It downloads the app with a one-time code already inside.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    OutlinedButton(
                        onClick = {
                            val link = "${BuildConfig.BEACON_WEB_URL.trimEnd('/')}/camera-mode"
                            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link)
                            context.startActivity(Intent.createChooser(send, "Send the link to the computer"))
                        },
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                    ) {
                        Text("Send the link to the computer", fontWeight = FontWeight.Bold)
                    }
                }
            null -> Unit
        }
        BeaconTrustLine("Only connect or use devices you own or are authorized to access.")
    }
}

@Composable
private fun AddDevicePanel(title: String, content: @Composable () -> Unit) {
    Surface(
        shape = RoundedCornerShape(BeaconRadii.Lg),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
            content()
        }
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
    val sensitiveContext = LocalContext.current
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
        title = { Text("Pair a phone or tablet") },
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
                            "On the other phone or tablet, open Beacon and scan this code, or open the link in Safari on an iPhone or iPad.",
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
                        OutlinedButton(onClick = { copySensitiveText(sensitiveContext, setupLink); copied = true }) {
                            Text(if (copied) "Copied" else "Copy setup link")
                        }
                        if (browserCameraLink != null) {
                            OutlinedButton(onClick = { copySensitiveText(sensitiveContext, browserCameraLink) }) {
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
