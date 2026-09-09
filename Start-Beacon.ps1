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
$arguments = @{
    Restart = $Restart
    NoBrowser = $NoBrowser
    InstallAndroid = $InstallAndroid
    CleanAndroidInstall = $CleanAndroidInstall
    SkipDependencyInstall = $SkipDependencyInstall
}
if ($LanHost) { $arguments.LanHost = $LanHost }
if ($AdbSerial) { $arguments.AdbSerial = $AdbSerial }
& (Join-Path $PSScriptRoot 'scripts\Quick-Start.ps1') @arguments
