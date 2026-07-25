[CmdletBinding()]
param(
    [string]$LanHost,
    [switch]$SkipAdbCheck
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot
$statePath = Join-Path $repositoryRoot '.beacon-dev\lan-dev.json'
if (-not $LanHost) {
    if (-not (Test-Path $statePath)) {
        throw 'Pass -LanHost or start LAN development first.'
    }
    $LanHost = (Get-Content -Raw $statePath | ConvertFrom-Json).lanHost
}
$origin = "https://${LanHost}:8443"

foreach ($service in @('postgres', 'coturn', 'secure-proxy')) {
    $containerId = (& docker compose -f infrastructure/docker/compose.yaml --profile secure ps -q $service).Trim()
    if (-not $containerId) {
        throw "$service is not running."
    }
}
$postgresId = (& docker compose -f infrastructure/docker/compose.yaml ps -q postgres).Trim()
$postgresHealth = (& docker inspect --format '{{.State.Health.Status}}' $postgresId).Trim()
if ($postgresHealth -ne 'healthy') {
    throw "PostgreSQL health is '$postgresHealth'."
}

$backend = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 5
if ($backend.StatusCode -ne 200) { throw 'Backend health check failed.' }
$viewer = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 5
if ($viewer.StatusCode -ne 200) { throw 'Vite did not respond on strict port 5173.' }

$certificatePath = Join-Path $repositoryRoot 'artifacts\dev-ca\beacon-caddy-root.crt'
& $PSScriptRoot\Export-BeaconDevCertificate.ps1 -OutputPath $certificatePath
& node scripts\Test-BeaconHttps.mjs "$origin/" $certificatePath $LanHost
if ($LASTEXITCODE -ne 0) { throw 'Trusted HTTPS validation failed.' }

$activeCaddy = & docker compose -f infrastructure/docker/compose.yaml --profile secure exec -T secure-proxy caddy adapt --config /etc/caddy/Caddyfile
if ($activeCaddy -notmatch [regex]::Escape($LanHost)) {
    throw "The active Caddy configuration does not contain $LanHost."
}
$cameraId = '00000000-0000-4000-8000-000000000000'
& node scripts\Test-BeaconWss.mjs "wss://${LanHost}:8443/api/signaling?role=viewer&cameraId=$cameraId" $certificatePath $origin
if ($LASTEXITCODE -ne 0) { throw 'Trusted WSS validation failed.' }
& $PSScriptRoot\Test-BeaconTurnRelay.ps1 -LanHost $LanHost

if (-not $SkipAdbCheck) {
    $adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
    if (-not $adb) {
        $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    }
    if (-not (Test-Path $adb)) {
        throw 'adb is unavailable in PATH and the default Android SDK location.'
    }
    & $adb get-state
    if ($LASTEXITCODE -ne 0) { throw 'No authorized adb device is connected.' }
    & $adb shell toybox nc -z -w 5 $LanHost 8443
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'adb could not prove TCP 8443 reachability; check phone toybox support, firewall, and Wi-Fi isolation.'
    } else {
        Write-Host 'The connected phone reached laptop TCP port 8443.'
    }
    & $adb shell toybox nc -z -w 5 $LanHost 3478
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'The phone could not prove TURN TCP 3478 reachability; check firewall rules.'
    } else {
        Write-Host 'The connected phone reached TURN TCP port 3478.'
    }
}
Write-Host "Beacon LAN development validation passed for $origin"
