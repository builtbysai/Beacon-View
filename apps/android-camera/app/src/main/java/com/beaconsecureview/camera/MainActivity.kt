package com.beaconsecureview.camera

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val credentialStore = CredentialStore(this)
        val preferences = getSharedPreferences("beacon_installation", MODE_PRIVATE)
        val installationId =
            preferences.getString("installation_id", null)
                ?: UUID.randomUUID().toString().also {
                    preferences.edit().putString("installation_id", it).apply()
                }
        setContent {
            BeaconRegistration(
                api = BeaconApi(BuildConfig.BEACON_API_URL),
                credentialStore = credentialStore,
                installationId = installationId,
            )
        }
    }
}

@Composable
private fun BeaconRegistration(
    api: BeaconApi,
    credentialStore: CredentialStore,
    installationId: String,
) {
    var credential by remember { mutableStateOf(credentialStore.read()) }
    var pairingCode by remember { mutableStateOf("") }
    var message by remember {
        mutableStateOf(if (credential == null) "This device is not registered." else "Registered")
    }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(credential) {
        while (credential != null) {
            delay(30_000)
            val current = credential ?: break
            val accepted = withContext(Dispatchers.IO) { api.heartbeat(current) }
            message = if (accepted) "Heartbeat sent" else "Credential revoked or unavailable"
            if (!retainCredentialAfterHeartbeat(credentialStore, accepted)) {
                credential = null
            }
        }
    }

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Beacon SecureView", style = MaterialTheme.typography.headlineMedium)
                Text(message, modifier = Modifier.padding(vertical = 16.dp))
                if (credential == null) {
                    OutlinedTextField(
                        value = pairingCode,
                        onValueChange = { pairingCode = it.uppercase() },
                        label = { Text("Pairing code") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                    Button(
                        enabled = pairingCode.isNotBlank() && !busy,
                        onClick = {
                            busy = true
                            message = "Pairing…"
                            scope.launch {
                                runCatching {
                                    withContext(Dispatchers.IO) {
                                        api.register(installationId, "Android Camera", pairingCode)
                                    }
                                }.onSuccess {
                                    credentialStore.save(it)
                                    credential = it
                                    pairingCode = ""
                                    message = "Pairing succeeded"
                                    busy = false
                                }.onFailure {
                                    message = "Pairing failed"
                                    busy = false
                                }
                            }
                        },
                    ) {
                        Text("Pair device")
                    }
                } else {
                    Button(
                        onClick = {
                            credentialStore.clear()
                            credential = null
                            message = "Local credential cleared"
                        },
                    ) {
                        Text("Clear local credential")
                    }
                }
            }
        }
    }
}
