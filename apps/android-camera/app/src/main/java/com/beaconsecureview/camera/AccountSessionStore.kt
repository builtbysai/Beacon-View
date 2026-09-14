package com.beaconsecureview.camera

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stores the household viewer session separately from the camera's scoped device credential. */
class AccountSessionStore(context: Context) {
    private val preferences =
        context.getSharedPreferences("beacon_account_session", Context.MODE_PRIVATE)

    fun save(session: BeaconApi.AccountSession) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        preferences.edit()
            .putString(
                CIPHERTEXT,
                Base64.encodeToString(cipher.doFinal(session.token.toByteArray()), Base64.NO_WRAP),
            )
            .putString(IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(USER_ID, session.userId)
            .apply()
    }

    fun read(): BeaconApi.AccountSession? {
        val ciphertext = preferences.getString(CIPHERTEXT, null) ?: return null
        val iv = preferences.getString(IV, null) ?: return null
        val storedUserId = preferences.getString(USER_ID, null)
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            val token = String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)))
            BeaconApi.AccountSession(token = token, userId = storedUserId ?: legacyUserKey(token))
        }.getOrNull()
    }

    fun clear() = preferences.edit().clear().apply()

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build(),
                )
            }.generateKey()
    }

    private fun legacyUserKey(token: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(token.toByteArray())
        return "legacy:" + Base64.encodeToString(digest, Base64.NO_WRAP or Base64.URL_SAFE)
    }

    private companion object {
        const val KEY_ALIAS = "beacon_account_session"
        const val CIPHERTEXT = "ciphertext"
        const val IV = "iv"
        const val USER_ID = "user_id"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
