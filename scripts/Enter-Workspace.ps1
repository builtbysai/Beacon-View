# Dot-source this file in the development shell: . ./scripts/Enter-Workspace.ps1
[CmdletBinding()]
param([string]$PrivateRoot = $env:BEACON_PRIVATE_DIR)
$ErrorActionPreference = 'Stop'
if (-not $PrivateRoot) {
    $PrivateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\Beacon-Secrets'))
}
if (-not (Test-Path -LiteralPath $PrivateRoot -PathType Container)) {
    throw 'Private workspace folder missing. Pass -PrivateRoot with its current location; never create replacement keys implicitly.'
}
$PrivateRoot = [IO.Path]::GetFullPath($PrivateRoot)
$env:BEACON_PRIVATE_DIR = $PrivateRoot
$env:BEACON_ENV_FILE = Join-Path $PrivateRoot 'view\local\backend.env'
$env:COMPOSE_ENV_FILES = $env:BEACON_ENV_FILE
$env:BEACON_UPDATE_SIGNING_KEY = Join-Path $PrivateRoot 'view\signing\update-private-key.pem'
$env:BEACON_DEBUG_KEYSTORE = Join-Path $PrivateRoot 'view\signing\android\alpha-debug.keystore'
Write-Host 'Development secret paths configured. No secret values were displayed.'
