import java.net.URI
import java.security.MessageDigest

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

// ADR 0073/0075: the smart-detection experiment is default-off in every build.
// Flipping it on (Gradle property or env var, matching the beaconApiUrl pattern)
// is a deliberate, controlled-test choice, never a production default.
val smartDetectionEnabled: Boolean =
    providers.gradleProperty("smartDetectionEnabled")
        .orElse(providers.environmentVariable("SMART_DETECTION_ENABLED"))
        .orElse("false")
        .map(String::toBoolean)
        .get()

val smartDetectionModelDir = layout.buildDirectory.dir("generated/smartDetectionAssets")

// ADR 0075: download and checksum-verify the model at build time instead of
// committing a ~4.4 MiB binary to git history. Only runs when the experiment
// is enabled, so an ordinary build never touches the network for this.
val downloadSmartDetectionModel by tasks.registering {
    val modelUrl =
        "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite"
    val expectedSha256 = "0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb"
    val outputDirectory = smartDetectionModelDir
    outputs.dir(outputDirectory)
    onlyIf { smartDetectionEnabled }
    doLast {
        val destination = outputDirectory.get().file("efficientdet_lite0.tflite").asFile
        destination.parentFile.mkdirs()
        if (!destination.exists()) {
            URI(modelUrl).toURL().openStream().use { input ->
                destination.outputStream().use { output -> input.copyTo(output) }
            }
        }
        val digest = MessageDigest.getInstance("SHA-256")
        destination.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var read = input.read(buffer)
            while (read != -1) {
                digest.update(buffer, 0, read)
                read = input.read(buffer)
            }
        }
        val actualSha256 = digest.digest().joinToString("") { "%02x".format(it) }
        if (actualSha256 != expectedSha256) {
            destination.delete()
            throw GradleException(
                "Smart-detection model checksum mismatch: expected $expectedSha256 but got $actualSha256",
            )
        }
    }
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
            buildConfigField("boolean", "SMART_DETECTION_ENABLED", "$smartDetectionEnabled")
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
            buildConfigField("boolean", "SMART_DETECTION_ENABLED", "$smartDetectionEnabled")
        }
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(smartDetectionModelDir)
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

tasks.named("preBuild") { dependsOn(downloadSmartDetectionModel) }

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation(platform("com.google.firebase:firebase-bom:34.18.0"))
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-video:1.4.2")
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
    implementation("io.github.webrtc-sdk:android:144.7559.08")
    // ADR 0074/0075: smart-detection experiment runtime. The model asset is
    // fetched separately by downloadSmartDetectionModel, not bundled here.
    implementation("com.google.mediapipe:tasks-vision:1.0.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation(kotlin("test"))
}
