[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot
if (-not $OutputPath) {
    $OutputPath = Join-Path $repositoryRoot 'artifacts\dev-ca\beacon-caddy-root.crt'
}
$resolvedParent = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $resolvedParent | Out-Null

$containerId = (& docker compose -f infrastructure/docker/compose.yaml --profile secure ps -q secure-proxy).Trim()
if (-not $containerId) {
    throw 'The secure-proxy container is not running.'
}
& docker cp "${containerId}:/data/caddy/pki/authorities/local/root.crt" $OutputPath
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to export the Caddy root certificate.'
}
Write-Host "Caddy development root CA exported to: $OutputPath"
Write-Host 'This public certificate may be installed for development; never export the CA private key.'
