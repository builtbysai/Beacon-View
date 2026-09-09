[CmdletBinding()]
param(
    [switch]$SkipDatabaseIntegration,
    [switch]$SkipAndroid
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'scripts\Quick-Test.ps1') `
    -SkipDatabaseIntegration:$SkipDatabaseIntegration `
    -SkipAndroid:$SkipAndroid
