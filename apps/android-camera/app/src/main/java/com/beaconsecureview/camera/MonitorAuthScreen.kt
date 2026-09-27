package com.beaconsecureview.camera

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

private enum class AndroidAuthView { SignIn, Register, ForgotPassword, ResetSent }

internal fun registrationReady(
    email: String,
    password: String,
    confirmPassword: String,
): Boolean = email.isNotBlank() && password.length >= 12 && password == confirmPassword

@Composable
internal fun MonitorAuthScreen(
    email: String,
    password: String,
    showPassword: Boolean,
    busy: Boolean,
    message: String,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onShowPasswordChange: (Boolean) -> Unit,
    onSignIn: () -> Unit,
    onCreateAccount: () -> Unit,
    onGoogleSignIn: () -> Unit,
    onCameraMode: () -> Unit,
    requestPasswordReset: suspend (String) -> Result<Unit>,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var view by rememberSaveable { mutableStateOf(AndroidAuthView.SignIn) }
    var resetEmail by rememberSaveable { mutableStateOf("") }
    var resetBusy by remember { mutableStateOf(false) }
    var resetError by remember { mutableStateOf("") }
    var confirmPassword by rememberSaveable { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Xl),
    ) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth().height(76.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BeaconWordmark(compact = true)
                TextButton(
                    onClick = onCameraMode,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, null)
                    Text("Back to Beacon", modifier = Modifier.padding(start = BeaconSpacing.Xs))
                }
            }
            Spacer(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
        }

        Column(
            modifier = Modifier.fillMaxWidth().padding(top = BeaconSpacing.Xl),
            verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Lg),
        ) {
            when (view) {
                    AndroidAuthView.SignIn -> {
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Xs)) {
                            Text("Sign in", style = MaterialTheme.typography.headlineMedium)
                            Text("Continue to your Beacon cameras.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (message.isNotBlank()) {
                            Text(
                                message,
                                color = MaterialTheme.colorScheme.error,
                                modifier =
                                    Modifier.fillMaxWidth()
                                        .background(MaterialTheme.colorScheme.error.copy(alpha = 0.1f), RoundedCornerShape(BeaconRadii.Md))
                                        .padding(BeaconSpacing.Md),
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                            Text("Email", style = MaterialTheme.typography.labelMedium)
                            OutlinedTextField(
                                value = email,
                                onValueChange = onEmailChange,
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("Password", style = MaterialTheme.typography.labelMedium)
                                TextButton(
                                    onClick = { view = AndroidAuthView.ForgotPassword },
                                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
                                ) { Text("Forgot password?", textDecoration = TextDecoration.Underline) }
                            }
                            OutlinedTextField(
                                value = password,
                                onValueChange = onPasswordChange,
                                singleLine = true,
                                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                                trailingIcon = {
                                    IconButton(onClick = { onShowPasswordChange(!showPassword) }) {
                                        Icon(Icons.Outlined.Visibility, if (showPassword) "Hide password" else "Show password")
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Button(
                            enabled = !busy,
                            onClick = onSignIn,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface),
                            shape = RoundedCornerShape(BeaconRadii.Md),
                        ) { Text(if (busy) "Signing in…" else "Sign in") }
                        AuthDivider()
                        OutlinedButton(
                            enabled = !busy,
                            onClick = onGoogleSignIn,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(BeaconRadii.Md),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
                        ) {
                            Text("G", color = Color(0xFF4285F4), fontWeight = FontWeight.ExtraBold)
                            Text("Continue with Google", modifier = Modifier.padding(start = BeaconSpacing.Sm))
                        }
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                            Text("New to Beacon?", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            TextButton(
                                onClick = {
                                    onPasswordChange("")
                                    confirmPassword = ""
                                    view = AndroidAuthView.Register
                                },
                            ) {
                                Text(
                                    "Create an account",
                                    color = MaterialTheme.colorScheme.onSurface,
                                    fontWeight = FontWeight.Bold,
                                    textDecoration = TextDecoration.Underline,
                                )
                            }
                        }
                        TextButton(onClick = onCameraMode, modifier = Modifier.fillMaxWidth()) {
                            Text("Use this device as a camera")
                        }
                    }
                    AndroidAuthView.Register -> {
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Xs)) {
                            Text("Create your account", style = MaterialTheme.typography.headlineMedium)
                            Text("Set up Beacon in a few moments.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (message.isNotBlank()) {
                            Text(
                                message,
                                color = MaterialTheme.colorScheme.error,
                                modifier =
                                    Modifier.fillMaxWidth()
                                        .background(MaterialTheme.colorScheme.error.copy(alpha = 0.1f), RoundedCornerShape(BeaconRadii.Md))
                                        .padding(BeaconSpacing.Md),
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                            Text("Email", style = MaterialTheme.typography.labelMedium)
                            OutlinedTextField(
                                value = email,
                                onValueChange = onEmailChange,
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                            Text("Password", style = MaterialTheme.typography.labelMedium)
                            OutlinedTextField(
                                value = password,
                                onValueChange = onPasswordChange,
                                singleLine = true,
                                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                                trailingIcon = {
                                    IconButton(onClick = { onShowPasswordChange(!showPassword) }) {
                                        Icon(Icons.Outlined.Visibility, if (showPassword) "Hide password" else "Show password")
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text(
                                "Use at least 12 characters.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                            Text("Confirm password", style = MaterialTheme.typography.labelMedium)
                            OutlinedTextField(
                                value = confirmPassword,
                                onValueChange = { confirmPassword = it },
                                singleLine = true,
                                isError = confirmPassword.isNotEmpty() && confirmPassword != password,
                                visualTransformation = PasswordVisualTransformation(),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            if (confirmPassword.isNotEmpty() && confirmPassword != password) {
                                Text("Passwords do not match.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        Button(
                            enabled = registrationReady(email, password, confirmPassword) && !busy,
                            onClick = onCreateAccount,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface),
                            shape = RoundedCornerShape(BeaconRadii.Md),
                        ) { Text(if (busy) "Creating account…" else "Create account") }
                        AuthDivider()
                        OutlinedButton(
                            enabled = !busy,
                            onClick = onGoogleSignIn,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(BeaconRadii.Md),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
                        ) {
                            Text("G", color = Color(0xFF4285F4), fontWeight = FontWeight.ExtraBold)
                            Text("Continue with Google", modifier = Modifier.padding(start = BeaconSpacing.Sm))
                        }
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                            Text("Already have an account?", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            TextButton(
                                onClick = {
                                    onPasswordChange("")
                                    confirmPassword = ""
                                    view = AndroidAuthView.SignIn
                                },
                            ) {
                                Text(
                                    "Sign in",
                                    color = MaterialTheme.colorScheme.onSurface,
                                    fontWeight = FontWeight.Bold,
                                    textDecoration = TextDecoration.Underline,
                                )
                            }
                        }
                    }
                    AndroidAuthView.ForgotPassword -> {
                        IconButton(onClick = { view = AndroidAuthView.SignIn }) {
                            Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to sign in")
                        }
                        Text("Reset your password", style = MaterialTheme.typography.headlineMedium)
                        Text("Enter your email and we'll send you a reset link.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        OutlinedTextField(
                            value = resetEmail,
                            onValueChange = { resetEmail = it },
                            label = { Text("Email") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (resetError.isNotBlank()) Text(resetError, color = MaterialTheme.colorScheme.error)
                        Button(
                            enabled = resetEmail.isNotBlank() && !resetBusy,
                            onClick = {
                                resetBusy = true
                                resetError = ""
                                scope.launch {
                                    requestPasswordReset(resetEmail)
                                        .onSuccess { view = AndroidAuthView.ResetSent }
                                        .onFailure { resetError = "Reset email could not be sent. Try again." }
                                    resetBusy = false
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(if (resetBusy) "Sending…" else "Send reset link") }
                    }
                    AndroidAuthView.ResetSent -> {
                        Text("Check your email", style = MaterialTheme.typography.headlineMedium)
                        Text(
                            "If an account exists for that address, you'll receive a password reset link shortly.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Button(onClick = { view = AndroidAuthView.SignIn }, modifier = Modifier.fillMaxWidth()) { Text("Back to sign in") }
                    }
            }
        }

        Spacer(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
        Text("Beacon · Private alpha", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(BeaconSpacing.Xl)) {
            TextButton(
                onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${BuildConfig.BEACON_API_URL.trimEnd('/')}/trust"))) },
                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
            ) { Text("Trust & privacy", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            TextButton(
                onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${BuildConfig.BEACON_API_URL.trimEnd('/')}/contact"))) },
                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
            ) { Text("Contact", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun AuthDivider() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(BeaconSpacing.Md),
    ) {
        Spacer(Modifier.height(1.dp).weight(1f).background(MaterialTheme.colorScheme.outlineVariant))
        Text("OR", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(1.dp).weight(1f).background(MaterialTheme.colorScheme.outlineVariant))
    }
}
