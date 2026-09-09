[CmdletBinding()]
param(
    [string]$LanHost,
    [string]$SharedSecret = 'local-development-turn-shared-secret'
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
$peerName = "beacon-turn-peer-$PID"
try {
    & docker run -d --rm --name $peerName `
        --network beacon-secureview-local_default `
        coturn/coturn:4.6.3-r3 turnutils_peer -L 0.0.0.0 -p 3480 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to start the temporary TURN peer.' }
    $peerIp = (& docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $peerName).Trim()
    if (-not $peerIp) { throw 'Temporary TURN peer has no network address.' }
    & docker exec beacon-secureview-local-coturn-1 timeout 30 turnutils_uclient `
        -W $SharedSecret -e $peerIp -r 3480 -c -n 3 $LanHost
    if ($LASTEXITCODE -ne 0) { throw 'Authenticated TURN relay traffic failed.' }
    Write-Host 'Authenticated TURN relay traffic passed with zero required packet loss.'
} finally {
    $runningPeer = (& docker ps -q --filter "name=^${peerName}$").Trim()
    if ($runningPeer) { & docker stop $peerName *> $null }
}
