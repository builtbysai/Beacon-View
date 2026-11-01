# Dot-source this file in the development shell: . ./scripts/Enter-Workspace.ps1
[CmdletBinding()]
param([string]$PrivateRoot = $env:BEACON_PRIVATE_DIR)
$ErrorActionPreference = 'Stop'
if (-not $PrivateRoot) {
    $PrivateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\Beacon-Private'))
}
if (-not (Test-Path -LiteralPath $PrivateRoot -PathType Container)) {
    throw 'Private workspace folder missing. Pass -PrivateRoot with its current location; never create replacement keys implicitly.'
}
$PrivateRoot = [IO.Path]::GetFullPath($PrivateRoot)
$env:BEACON_PRIVATE_DIR = $PrivateRoot
$env:BEACON_ENV_FILE = Join-Path $PrivateRoot 'view\backend.env'
$env:BEACON_UPDATE_SIGNING_KEY = Join-Path $PrivateRoot 'signing-and-deployment\update-signing-key.pem'
Write-Host 'Development secret paths configured. No secret values were displayed.'
