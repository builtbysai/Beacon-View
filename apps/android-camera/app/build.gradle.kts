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
        // Play rejects a versionCode it has seen, so each upload raises it:
        //   ./gradlew :app:bundleRelease -PbeaconVersionCode=2 -PbeaconVersionName=0.1.0
        versionCode = providers.gradleProperty("beaconVersionCode").orElse("1").get().toInt()
        versionName = providers.gradleProperty("beaconVersionName").orElse("0.0.0").get()

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // The upload key is created and kept by the owner (docs/android-release.md). It is read from the
    // environment so it never lands in the repository; without it the release build is unsigned, as before.
    signingConfigs {
        val uploadKeystore = providers.environmentVariable("BEACON_UPLOAD_KEYSTORE").orNull
        if (uploadKeystore != null) {
            create("release") {
                storeFile = file(uploadKeystore)
                storePassword = providers.environmentVariable("BEACON_UPLOAD_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("BEACON_UPLOAD_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("BEACON_UPLOAD_KEY_PASSWORD").get()
            }
        }
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
            val beaconWebUrl =
                providers.gradleProperty("beaconWebUrl")
                    .orElse(providers.environmentVariable("BEACON_WEB_URL"))
                    .orElse("http://10.0.2.2:5173")
                    .get()
            require(beaconWebUrl.startsWith("http://") || beaconWebUrl.startsWith("https://")) {
                "beaconWebUrl must use http:// or https://"
            }
            buildConfigField("String", "BEACON_WEB_URL", "\"$beaconWebUrl\"")
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
            // A signed release with the placeholder address cannot reach any server: refuse to build one (alpha11 to
            // alpha13 were published that way). Unsigned CI builds keep the placeholder.
            require(
                beaconApiUrl != "https://invalid.beacon.local" ||
                    providers.environmentVariable("BEACON_UPLOAD_KEYSTORE").orNull == null,
            ) {
                "Set BEACON_RELEASE_API_URL (https://beacon.builtbysai.com) before building a signed release."
            }
            buildConfigField("String", "BEACON_API_URL", "\"$beaconApiUrl\"")
            val beaconWebUrl =
                providers.gradleProperty("beaconReleaseWebUrl")
                    .orElse(providers.environmentVariable("BEACON_RELEASE_WEB_URL"))
                    .orElse(beaconApiUrl)
                    .get()
            require(beaconWebUrl.startsWith("https://")) { "Release Beacon web URL must use https://" }
            buildConfigField("String", "BEACON_WEB_URL", "\"$beaconWebUrl\"")
            buildConfigField("boolean", "SMART_DETECTION_ENABLED", "$smartDetectionEnabled")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(smartDetectionModelDir)
        }
        // The MediaPipe-backed detector is compiled only for the controlled test build (V62).
        getByName("main").java.srcDir(if (smartDetectionEnabled) "src/smartOn/java" else "src/smartOff/java")
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
    implementation("androidx.webkit:webkit:1.12.1")
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
    if (smartDetectionEnabled) implementation("com.google.mediapipe:tasks-vision:1.0.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation(kotlin("test"))
    // The android.jar used by unit tests only stubs org.json; this is the reference implementation.
    testImplementation("org.json:json:20240303")
}

// Pin and record the shipped dependency versions so the weekly OSV scan (.github/workflows/dependency-audit.yml)
// can read them (V24). Refresh with: ./gradlew :app:dependencies --write-locks
configurations
    .matching { it.name == "releaseRuntimeClasspath" }
    .configureEach { resolutionStrategy.activateDependencyLocking() }
