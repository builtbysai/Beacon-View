[CmdletBinding()]
param(
    [string]$LanHost,
    [Alias('DeviceSerial')]
    [string]$AdbSerial,
    [switch]$Emulator,
    [switch]$CleanInstall,
    [switch]$NoLaunch,
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot

function Resolve-Adb {
    $command = Get-Command adb -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidates = @(
        if ($env:ANDROID_SDK_ROOT) { Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe' }
        if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' }
        if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe' }
    )
    $found = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($found) { return $found }
    throw 'adb was not found in PATH, ANDROID_SDK_ROOT, ANDROID_HOME, or the default Android SDK location.'
}

function Resolve-JavaHome {
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
        return $env:JAVA_HOME
    }
    $candidates = @(
        'C:\Program Files\Android\Android Studio\jbr',
        'C:\Program Files\Android\Android Studio\jre'
    )
    $found = $candidates | Where-Object {
        Test-Path -LiteralPath (Join-Path $_ 'bin\java.exe')
    } | Select-Object -First 1
    if ($found) { return $found }
    throw 'JDK 17 was not found. Set JAVA_HOME or install Android Studio with its bundled JDK.'
}

function Assert-TargetHost([string]$Address) {
    if ($Emulator) {
        if ($Address -notin @('10.0.2.2', '127.0.0.1', 'localhost')) {
            throw "Emulator builds must use 10.0.2.2, localhost, or 127.0.0.1; received '$Address'."
        }
        return
    }
    $parsed = $null
    if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsed) -or
        $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
        [Net.IPAddress]::IsLoopback($parsed) -or
        $Address -match '^169\.254\.') {
        throw "A physical-device build requires a reachable non-loopback LAN IPv4 address; received '$Address'. Use -Emulator for an emulator build."
    }
}

if (-not $LanHost) {
    $statePath = Join-Path $repositoryRoot '.beacon-dev\lan-dev.json'
    if (-not (Test-Path -LiteralPath $statePath)) {
        throw 'Pass -LanHost or start LAN development first.'
    }
    $LanHost = (Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json).lanHost
}
Assert-TargetHost $LanHost

$adb = Resolve-Adb
$env:JAVA_HOME = Resolve-JavaHome
$androidBuildRoot = Join-Path $env:LOCALAPPDATA 'BeaconSecureView\android-build'
$backendOrigin = if ($Emulator) { "http://${LanHost}:3000" } else { "https://${LanHost}:8443" }
$signalingUrl = $backendOrigin -replace '^http', 'ws'
$stunUrl = "stun:${LanHost}:3478"
$turnUrl = "turn:${LanHost}:3478?transport=udp"
$env:BEACON_API_URL = $backendOrigin

$deviceLines = @(& $adb devices) | Select-Object -Skip 1 | Where-Object { $_ -match '\S' }
$devices = @($deviceLines | ForEach-Object {
    $parts = $_ -split '\s+', 2
    [pscustomobject]@{ Serial = $parts[0]; State = $parts[1] }
})
if ($AdbSerial) {
    $selected = $devices | Where-Object { $_.Serial -eq $AdbSerial } | Select-Object -First 1
    if (-not $selected) { throw "ADB device '$AdbSerial' is not connected." }
} else {
    $usable = @($devices | Where-Object { $_.State -eq 'device' })
    $blocked = @($devices | Where-Object { $_.State -ne 'device' })
    if ($usable.Count -eq 0) {
        if ($blocked.Count -gt 0) {
            $details = ($blocked | ForEach-Object { "$($_.Serial)=$($_.State)" }) -join ', '
            throw "No usable Android device is connected. Resolve USB authorization/offline state: $details"
        }
        throw 'No Android device is connected. Connect a device with USB debugging enabled.'
    }
    if ($usable.Count -gt 1) {
        $physical = @($usable | Where-Object { $_.Serial -notmatch '^emulator-' })
        if ($physical.Count -eq 1) {
            $selected = $physical[0]
            Write-Host "Automatically selected physical Android device $($selected.Serial); use -AdbSerial to choose another device."
        } elseif ($NonInteractive) {
            throw 'Multiple Android devices are connected and no single physical phone could be selected. Pass -AdbSerial in noninteractive mode.'
        } else {
            Write-Host 'Connected Android devices:'
            for ($index = 0; $index -lt $usable.Count; $index += 1) {
                Write-Host "[$($index + 1)] $($usable[$index].Serial)"
            }
            $choice = 0
            if (-not [int]::TryParse((Read-Host 'Select a device number'), [ref]$choice) -or
                $choice -lt 1 -or $choice -gt $usable.Count) {
                throw 'Invalid Android device selection.'
            }
            $selected = $usable[$choice - 1]
        }
    } else {
        $selected = $usable[0]
    }
}
if ($selected.State -eq 'unauthorized') { throw "ADB device '$($selected.Serial)' is unauthorized. Unlock it and accept the USB debugging prompt." }
if ($selected.State -eq 'offline') { throw "ADB device '$($selected.Serial)' is offline. Reconnect USB or restart adb." }
if ($selected.State -ne 'device') { throw "ADB device '$($selected.Serial)' is unavailable: $($selected.State)." }
$adbArguments = @('-s', $selected.Serial)

Write-Host "ADB device: $($selected.Serial)"
Write-Host "Backend origin: $backendOrigin"
Write-Host "Signaling: $signalingUrl/api/signaling"
Write-Host "STUN: $stunUrl"
Write-Host "TURN: $turnUrl"
Write-Host "JDK: $env:JAVA_HOME"

& apps\android-camera\gradlew.bat -p apps/android-camera `
    "-PbeaconBuildDir=$androidBuildRoot" :app:assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'Android debug build failed. Review the Gradle output above.' }

$apk = Join-Path $androidBuildRoot 'outputs\apk\debug\app-debug.apk'
if (-not (Test-Path -LiteralPath $apk)) { throw "Expected debug APK was not produced at '$apk'." }

# Stop capture cleanly before package replacement. Replacing an APK while CameraX is delivering a
# frame can terminate WebRTC inside a native callback and produce a misleading device crash record.
& $adb @adbArguments shell am force-stop 'com.beaconsecureview.camera'
if ($LASTEXITCODE -ne 0) { throw 'The running Beacon app could not be stopped before installation.' }

if ($CleanInstall) {
    & $adb @adbArguments uninstall 'com.beaconsecureview.camera' | Out-Host
    Write-Host 'Clean install requested: prior application data and pairing credentials were removed.'
    & $adb @adbArguments install $apk
} else {
    & $adb @adbArguments install -r $apk
}
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed. Review adb output and available device storage.' }

$package = & $adb @adbArguments shell dumpsys package com.beaconsecureview.camera
$packageText = $package -join "`n"
if ($LASTEXITCODE -ne 0 -or $packageText -notmatch 'versionName=') {
    throw 'Installation completed but the Beacon package/version could not be verified.'
}
$version = [regex]::Match($packageText, 'versionName=([^\s]+)').Groups[1].Value
if (-not $NoLaunch) {
    & $adb @adbArguments shell am start -n 'com.beaconsecureview.camera/.MainActivity'
    if ($LASTEXITCODE -ne 0) { throw 'Beacon installed but its activity could not be launched.' }
}

$dataMessage = if ($CleanInstall) {
    'Application data and pairing credentials were cleared.'
} else {
    'Application data and pairing credentials were preserved by the update install.'
}
Write-Host "Verified Beacon version $version configured for $backendOrigin. $dataMessage"
