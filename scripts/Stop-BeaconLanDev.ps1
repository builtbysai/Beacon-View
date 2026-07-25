[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot
Import-Module (Join-Path $PSScriptRoot 'BeaconDevProcesses.psm1') -Force
$statePath = Join-Path $repositoryRoot '.beacon-dev\lan-dev.json'

if (Test-Path $statePath) {
    $state = Get-Content -Raw $statePath | ConvertFrom-Json
    foreach ($tracked in @($state.processes)) {
        if ($tracked.owned -and $tracked.pid) {
            Stop-BeaconTrackedProcess $tracked.pid $repositoryRoot -TrustedState
        }
    }
    Remove-Item -LiteralPath $statePath -Force
}

& docker compose -f infrastructure/docker/compose.yaml --profile secure down
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose shutdown failed.'
}
Write-Host 'Beacon LAN development is stopped.'
