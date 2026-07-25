[CmdletBinding()]
param(
    [string]$LanHost,
    [string]$DeviceSerial
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot

if (-not $LanHost) {
    $statePath = Join-Path $repositoryRoot '.beacon-dev\lan-dev.json'
    if (-not (Test-Path $statePath)) {
        throw 'Pass -LanHost or start LAN development first.'
    }
    $LanHost = (Get-Content -Raw $statePath | ConvertFrom-Json).lanHost
}
$env:BEACON_API_URL = "https://${LanHost}:8443"
if (-not $env:JAVA_HOME -and (Test-Path 'C:\Program Files\Android\Android Studio\jbr')) {
    $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
}

$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb) {
    $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
}
if (-not (Test-Path $adb)) {
    throw 'adb is unavailable in PATH and the default Android SDK location.'
}
$adbArguments = @()
if ($DeviceSerial) {
    $adbArguments = @('-s', $DeviceSerial)
}
& $adb @adbArguments get-state
if ($LASTEXITCODE -ne 0) {
    throw 'No authorized Android device is available through adb.'
}
& apps\android-camera\gradlew.bat -p apps/android-camera :app:assembleDebug
if ($LASTEXITCODE -ne 0) {
    throw 'Android debug build failed.'
}
$apk = Join-Path $repositoryRoot 'apps\android-camera\app\build\outputs\apk\debug\app-debug.apk'
& $adb @adbArguments install -r $apk
if ($LASTEXITCODE -ne 0) {
    throw 'APK installation failed.'
}
& $adb @adbArguments shell am start -n 'com.beaconsecureview.camera/.MainActivity'
if ($LASTEXITCODE -ne 0) {
    throw 'The Beacon Android activity could not be launched.'
}
Write-Host "Installed and launched the debug app with endpoint $env:BEACON_API_URL"
