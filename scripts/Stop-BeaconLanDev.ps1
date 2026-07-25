[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot
$statePath = Join-Path $repositoryRoot '.beacon-dev\lan-dev.json'

if (Test-Path $statePath) {
    $state = Get-Content -Raw $statePath | ConvertFrom-Json
    foreach ($processId in @($state.backendPid, $state.viewerPid)) {
        if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            & taskkill.exe /PID $processId /T /F *> $null
        }
    }
    Remove-Item -LiteralPath $statePath -Force
}

& docker compose -f infrastructure/docker/compose.yaml --profile secure down
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose shutdown failed.'
}
Write-Host 'Beacon LAN development is stopped.'
