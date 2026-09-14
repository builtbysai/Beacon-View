plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// google-services.json is real Firebase client configuration, installed locally
// via scripts/Install-BeaconFirebaseAndroidConfig.ps1 and gitignored (ADR 0043).
// CI and fresh checkouts never have it, so this plugin is applied only when it's
// present rather than unconditionally in the `plugins {}` block above — applying
// it unconditionally makes `processDebugGoogleServices`/`processReleaseGoogleServices`
// hard-fail the whole build when the file is missing, even for tasks (unit tests,
// lint, plain compilation) that have nothing to do with Firebase.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

providers.gradleProperty("beaconBuildDir").orNull?.let {
    layout.buildDirectory.set(file(it))
}

android {
    namespace = "com.beaconsecureview.camera"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.beaconsecureview.camera"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            val beaconApiUrl =
                providers.gradleProperty("beaconApiUrl")
                    .orElse(providers.environmentVariable("BEACON_API_URL"))
                    .orElse("http://10.0.2.2:3000")
                    .get()
            require(beaconApiUrl.startsWith("http://") || beaconApiUrl.startsWith("https://")) {
                "beaconApiUrl must use http:// or https://"
            }
            buildConfigField("String", "BEACON_API_URL", "\"$beaconApiUrl\"")
        }
        release {
            val beaconApiUrl =
                providers.gradleProperty("beaconReleaseApiUrl")
                    .orElse(providers.environmentVariable("BEACON_RELEASE_API_URL"))
                    .orElse("https://invalid.beacon.local")
                    .get()
            require(beaconApiUrl.startsWith("https://")) {
                "Release Beacon API URL must use https://"
            }
            buildConfigField("String", "BEACON_API_URL", "\"$beaconApiUrl\"")
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation(platform("com.google.firebase:firebase-bom:34.18.0"))
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.firebase:firebase-installations")
    implementation("io.github.webrtc-sdk:android:144.7559.08")

    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation(kotlin("test"))
}
