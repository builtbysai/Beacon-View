package com.beaconsecureview.camera

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
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
    googleSignInAvailable: Boolean,
    onCameraMode: () -> Unit,
    requestPasswordReset: suspend (String) -> Result<Unit>,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var view by rememberSaveable { mutableStateOf(AndroidAuthView.SignIn) }
    var resetEmail by rememberSaveable { mutableStateOf("") }
    var resetBusy by remember { mutableStateOf(false) }
    var confirmPassword by rememberSaveable { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Xl),
    ) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = 76.dp),
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
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Xs)) {
                            Text("Sign in", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
                            Text("Continue to your Beacon cameras.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                            Text("Email", style = MaterialTheme.typography.labelMedium)
                            OutlinedTextField(
                                value = email,
                                onValueChange = onEmailChange,
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
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
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                                trailingIcon = {
                                    IconButton(onClick = { onShowPasswordChange(!showPassword) }) {
                                        Icon(
                                            if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                            if (showPassword) "Hide password" else "Show password",
                                        )
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Button(
                            enabled = !busy,
                            onClick = onSignIn,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface),
                            shape = RoundedCornerShape(BeaconRadii.Md),
                        ) { Text(if (busy) "Signing in…" else "Sign in") }
                        AuthDivider()
                        OutlinedButton(
                            enabled = !busy && googleSignInAvailable,
                            onClick = onGoogleSignIn,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            shape = RoundedCornerShape(BeaconRadii.Md),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
                        ) {
                            Text("G", color = Color(0xFF4285F4), fontWeight = FontWeight.ExtraBold)
                            Text(if (googleSignInAvailable) "Continue with Google" else "Google sign-in unavailable", modifier = Modifier.padding(start = BeaconSpacing.Sm), fontWeight = FontWeight.Bold)
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable {
                                onPasswordChange("")
                                confirmPassword = ""
                                view = AndroidAuthView.Register
                            },
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("New to Beacon?", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Create an account", modifier = Modifier.padding(start = BeaconSpacing.Xs), color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold, textDecoration = TextDecoration.Underline)
                        }
                        TextButton(onClick = onCameraMode, modifier = Modifier.fillMaxWidth()) {
                            Text("Use this device as a camera")
                        }
                    }
                    AndroidAuthView.Register -> {
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
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Xs)) {
                            Text("Create your account", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
                            Text("Set up Beacon in a few moments.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                            Text("Email", style = MaterialTheme.typography.labelMedium)
                            OutlinedTextField(
                                value = email,
                                onValueChange = onEmailChange,
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Sm)) {
                            Text("Password", style = MaterialTheme.typography.labelMedium)
                            OutlinedTextField(
                                value = password,
                                onValueChange = onPasswordChange,
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                                trailingIcon = {
                                    IconButton(onClick = { onShowPasswordChange(!showPassword) }) {
                                        Icon(
                                            if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                            if (showPassword) "Hide password" else "Show password",
                                        )
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
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
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
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface),
                            shape = RoundedCornerShape(BeaconRadii.Md),
                        ) { Text(if (busy) "Creating account…" else "Create account") }
                        AuthDivider()
                        OutlinedButton(
                            enabled = !busy && googleSignInAvailable,
                            onClick = onGoogleSignIn,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            shape = RoundedCornerShape(BeaconRadii.Md),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
                        ) {
                            Text("G", color = Color(0xFF4285F4), fontWeight = FontWeight.ExtraBold)
                            Text(if (googleSignInAvailable) "Continue with Google" else "Google sign-in unavailable", modifier = Modifier.padding(start = BeaconSpacing.Sm), fontWeight = FontWeight.Bold)
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
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Xs)) {
                            Text("Reset your password", style = MaterialTheme.typography.headlineMedium)
                            Text("Enter your email and we'll send you a reset link.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        OutlinedTextField(
                            value = resetEmail,
                            onValueChange = { resetEmail = it },
                            label = { Text("Email") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Button(
                            enabled = resetEmail.isNotBlank() && !resetBusy,
                            onClick = {
                                resetBusy = true
                                scope.launch {
                                    // Mirrors the PWA's onResetSubmit exactly: the response is
                                    // intentionally identical whether or not the account exists,
                                    // so a transport failure here still moves on to "sent" rather
                                    // than leaking success/failure as a signal.
                                    requestPasswordReset(resetEmail)
                                    resetBusy = false
                                    view = AndroidAuthView.ResetSent
                                }
                            },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface),
                            shape = RoundedCornerShape(BeaconRadii.Md),
                        ) { Text(if (resetBusy) "Sending…" else "Send reset link") }
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                            TextButton(onClick = { view = AndroidAuthView.SignIn }) {
                                Text(
                                    "← Back to sign in",
                                    color = MaterialTheme.colorScheme.onSurface,
                                    fontWeight = FontWeight.Bold,
                                    textDecoration = TextDecoration.Underline,
                                )
                            }
                        }
                    }
                    AndroidAuthView.ResetSent -> {
                        Box(
                            modifier = Modifier.size(42.dp).background(BeaconOnline.copy(alpha = 0.14f), CircleShape),
                            contentAlignment = Alignment.Center,
                        ) { Text("✓", color = BeaconOnline, fontWeight = FontWeight.Black) }
                        Column(verticalArrangement = Arrangement.spacedBy(BeaconSpacing.Xs)) {
                            Text("Check your email", style = MaterialTheme.typography.headlineMedium)
                            Text(
                                "If an account exists for that address, you'll receive a password reset link shortly.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Button(
                            onClick = { view = AndroidAuthView.SignIn },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface),
                            shape = RoundedCornerShape(BeaconRadii.Md),
                        ) { Text("Back to sign in") }
                    }
            }
        }

        Spacer(Modifier.fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
        Text("Beacon · Private alpha", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(BeaconSpacing.Xl)) {
            TextButton(
                onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${BuildConfig.BEACON_WEB_URL.trimEnd('/')}/trust"))) },
                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
            ) { Text("Trust & privacy", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            TextButton(
                onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${BuildConfig.BEACON_WEB_URL.trimEnd('/')}/contact"))) },
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
