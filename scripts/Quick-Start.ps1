[CmdletBinding()]
param(
    [string]$LanHost,
    [switch]$Restart,
    [switch]$NoBrowser,
    [switch]$InstallAndroid,
    [Alias('DeviceSerial')]
    [string]$AdbSerial,
    [switch]$CleanAndroidInstall,
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot

& (Join-Path $PSScriptRoot 'Initialize-BeaconDev.ps1') `
    -SkipDependencyInstall:$SkipDependencyInstall

$startArguments = @{
    SkipAdbCheck = -not $InstallAndroid
    NonInteractive = $true
}
if ($LanHost) { $startArguments.LanHost = $LanHost }
if ($Restart) { $startArguments.RestartExisting = $true }
else { $startArguments.ReuseExisting = $true }

& (Join-Path $PSScriptRoot 'Start-BeaconLanDev.ps1') @startArguments
if ($LASTEXITCODE -ne 0) { throw 'Beacon LAN startup failed.' }

$statePath = Join-Path $repositoryRoot '.beacon-dev\lan-dev.json'
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json

if ($InstallAndroid) {
    $androidArguments = @{ LanHost = $state.lanHost }
    if ($AdbSerial) { $androidArguments.AdbSerial = $AdbSerial }
    if ($CleanAndroidInstall) { $androidArguments.CleanInstall = $true }
    & (Join-Path $PSScriptRoot 'Build-Install-BeaconAndroidDebug.ps1') @androidArguments
    if ($LASTEXITCODE -ne 0) { throw 'Android installation failed.' }
}

if (-not $NoBrowser) {
    & (Join-Path $PSScriptRoot 'Open-BeaconLanDev.ps1') -Page Dashboard
}

Write-Host ''
Write-Host 'Beacon is ready.'
Write-Host "Dashboard: $($state.urls.dashboard)"
Write-Host "Monitor: $($state.urls.dashboard)/monitor"
Write-Host "Browser Camera: $($state.urls.browserCamera)"
Write-Host 'Stop everything: .\scripts\Quick-Stop.ps1'
Write-Host 'Validate everything: .\scripts\Quick-Test.ps1'
