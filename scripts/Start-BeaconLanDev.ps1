[CmdletBinding()]
param(
    [string]$LanHost,
    [ValidateRange(1024, 65535)]
    [int]$TurnMinPort = 49160,
    [ValidateRange(1024, 65535)]
    [int]$TurnMaxPort = 49200,
    [switch]$SkipAdbCheck,
    [switch]$ReuseExisting,
    [switch]$RestartExisting,
    [switch]$FailOnPortConflict,
    [switch]$NonInteractive,
    [switch]$Status
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot
Import-Module (Join-Path $PSScriptRoot 'BeaconDevProcesses.psm1') -Force
$stateDirectory = Join-Path $repositoryRoot '.beacon-dev'
$statePath = Join-Path $stateDirectory 'lan-dev.json'
Remove-StaleBeaconDevState $statePath

if ($Status) {
    $state = Read-BeaconDevState $statePath
    if (-not $state) {
        Write-Host 'Beacon LAN development is not running.'
        exit 0
    }
    Write-Host "Beacon LAN development started $($state.startTime)."
    Write-Host "Dashboard: $($state.urls.dashboard)"
    Write-Host "Browser Camera: $($state.urls.browserCamera)"
    foreach ($tracked in $state.processes) {
        $alive = [bool](Get-Process -Id $tracked.pid -ErrorAction SilentlyContinue)
        Write-Host "$($tracked.name): PID $($tracked.pid) alive=$alive"
    }
    exit 0
}

function Get-BeaconLanAddress {
    $candidate = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
        Where-Object {
            $_.OperationalStatus -eq [Net.NetworkInformation.OperationalStatus]::Up -and
            $_.NetworkInterfaceType -notin @(
                [Net.NetworkInformation.NetworkInterfaceType]::Loopback,
                [Net.NetworkInformation.NetworkInterfaceType]::Tunnel
            ) -and
            "$($_.Name) $($_.Description)" -notmatch 'Docker|vEthernet|WSL|VPN|Virtual'
        } |
        ForEach-Object {
            $_.GetIPProperties().UnicastAddresses |
                Where-Object {
                    $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and
                    $_.Address.IPAddressToString -notmatch '^(127\.|169\.254\.)'
                } |
                ForEach-Object { $_.Address.IPAddressToString }
        } |
        Select-Object -First 1
    if (-not $candidate) {
        throw 'No suitable LAN IPv4 address was detected. Pass -LanHost explicitly.'
    }
    return $candidate
}

function Assert-BeaconLanAddress([string]$Address) {
    $parsed = $null
    if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsed) -or
        $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
        [Net.IPAddress]::IsLoopback($parsed) -or
        $Address -match '^169\.254\.') {
        throw "BEACON_LAN_HOST must be a non-loopback IPv4 address; received '$Address'."
    }
}

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is unavailable."
    }
}

function Resolve-Adb {
    $command = Get-Command adb -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $sdkAdb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (Test-Path $sdkAdb) { return $sdkAdb }
    throw 'adb is unavailable in PATH and the default Android SDK location.'
}

if (-not $LanHost) {
    $LanHost = Get-BeaconLanAddress
}
Assert-BeaconLanAddress $LanHost
if ($TurnMinPort -gt $TurnMaxPort -or ($TurnMaxPort - $TurnMinPort) -gt 200) {
    throw 'The TURN relay range must be ordered and contain at most 201 ports.'
}
foreach ($command in @('docker', 'node', 'pnpm.cmd')) {
    Assert-Command $command
}
if (-not $SkipAdbCheck) {
    $adb = Resolve-Adb
}

$nodeVersion = (& node --version).TrimStart('v')
if ([version]$nodeVersion -lt [version]'22.13.0' -or [version]$nodeVersion -ge [version]'23.0.0') {
    throw "Node >=22.13.0 <23 is required; found v$nodeVersion."
}
if ((& pnpm.cmd --version).Trim() -ne '11.9.0') {
    throw "pnpm 11.9.0 is required."
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker Server is not reachable.'
}

$httpsOrigin = "https://${LanHost}:8443"
$env:BEACON_LAN_HOST = $LanHost
$env:BEACON_HTTPS_HOST = $LanHost
$env:BEACON_HTTPS_BIND = $LanHost
$env:BEACON_TURN_BIND = $LanHost
$env:BEACON_TURN_ADDRESS = $LanHost
$env:BEACON_TURN_MIN_PORT = "$TurnMinPort"
$env:BEACON_TURN_MAX_PORT = "$TurnMaxPort"
$env:BEACON_WEB_UPSTREAM = 'host.docker.internal:5173'
$env:VITE_DEV_HOST = '0.0.0.0'
$env:VITE_DEV_PORT = '5173'
$env:VITE_HMR_HOST = $LanHost
$env:VITE_HTTPS_PORT = '8443'
$env:VITE_ALLOWED_HOST = $LanHost
$env:VITE_BACKEND_PROXY_TARGET = 'http://127.0.0.1:3000'
$env:HOST = '0.0.0.0'
$env:WEB_ORIGIN = $httpsOrigin
$env:PUBLIC_BACKEND_ORIGIN = $httpsOrigin
$env:SIGNALING_PUBLIC_URL = "wss://${LanHost}:8443/api/signaling"
$env:ALLOW_INSECURE_LOCAL_DEV = 'false'
$env:VIEWER_STUN_URL = "stun:${LanHost}:3478"
$env:VIEWER_TURN_URL = "turn:${LanHost}:3478?transport=udp"
$env:VIEWER_TURN_TCP_URL = "turn:${LanHost}:3478?transport=tcp"
$env:DEVICE_STUN_URL = "stun:${LanHost}:3478"
$env:DEVICE_TURN_URL = "turn:${LanHost}:3478?transport=udp"
$env:DEVICE_TURN_TCP_URL = "turn:${LanHost}:3478?transport=tcp"
$env:TURN_SHARED_SECRET = 'local-development-turn-shared-secret'

New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
$reusePorts = @{}
$reuseOwnerPids = @{}
$existingState = Read-BeaconDevState $statePath
foreach ($port in @(3000, 5173)) {
    $listener = Get-BeaconListener $port
    if (-not $listener) { continue }
    $trackedListener = @($existingState.processes | Where-Object {
        $_.pid -eq $listener.Pid -and $_.port -eq $port
    }).Count -eq 1 -and
        $existingState.repositoryPath -eq $repositoryRoot
    $legacyOwnerPid =
        if ($port -eq 3000) { $existingState.backendPid }
        else { $existingState.viewerPid }
    $legacyTracked =
        $legacyOwnerPid -and
        (Get-Process -Id $legacyOwnerPid -ErrorAction SilentlyContinue)
    $belongsToBeacon =
        $trackedListener -or
        $legacyTracked -or
        (Test-BeaconProcess $listener $repositoryRoot)
    if (-not $belongsToBeacon) {
        Write-Host "Port $port is occupied by an unrelated process."
        Write-Host (Format-BeaconProcess $listener)
        throw 'Beacon will not terminate an unrelated process.'
    }
    $choice = $null
    if ($RestartExisting) { $choice = 'S' }
    elseif ($ReuseExisting) { $choice = 'R' }
    elseif ($FailOnPortConflict -or $NonInteractive) { $choice = 'Q' }
    else {
        Write-Host "Beacon development process detected on port $port."
        $choice = (Read-Host '[R] Reuse  [S] Stop and restart  [Q] Quit').Trim().ToUpperInvariant()
    }
    switch ($choice) {
        'R' {
            $reusePorts[$port] = $listener
            if ($legacyTracked) { $reuseOwnerPids[$port] = $legacyOwnerPid }
        }
        'S' {
            Stop-BeaconTrackedProcess -ProcessId $listener.Pid -RepositoryRoot $repositoryRoot
        }
        default { throw "Startup cancelled because port $port is occupied." }
    }
}

try {
    # Compose already recreates services whose configuration changed. Forcing every
    # container to restart disconnects a reused backend from PostgreSQL.
    & docker compose -f infrastructure/docker/compose.yaml --profile secure up -d
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Compose startup failed.'
    }

    if (-not $reusePorts.ContainsKey(3000)) {
        $backend = Start-Process -FilePath 'pnpm.cmd' `
            -ArgumentList @('--filter', '@beacon/backend', 'dev') `
            -WorkingDirectory $repositoryRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $stateDirectory 'backend.out.log') `
            -RedirectStandardError (Join-Path $stateDirectory 'backend.err.log') `
            -PassThru
    }
    if (-not $reusePorts.ContainsKey(5173)) {
        $viewer = Start-Process -FilePath 'pnpm.cmd' `
            -ArgumentList @('--filter', '@beacon/web-viewer', 'dev') `
            -WorkingDirectory $repositoryRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $stateDirectory 'viewer.out.log') `
            -RedirectStandardError (Join-Path $stateDirectory 'viewer.err.log') `
            -PassThru
    }

    Start-Sleep -Seconds 2
    if ($backend -and $backend.HasExited) {
        throw "Backend exited during startup. Inspect .beacon-dev/backend.err.log."
    }
    if ($viewer -and $viewer.HasExited) {
        throw "Vite exited during startup. Port 5173 is strict; inspect .beacon-dev/viewer.err.log."
    }

    $healthDeadline = [DateTime]::UtcNow.AddSeconds(30)
    $backendHealthy = $false
    do {
        try {
            $healthResponse = Invoke-WebRequest -UseBasicParsing `
                -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 3
            $backendHealthy = $healthResponse.StatusCode -eq 200
        } catch {
            $backendHealthy = $false
        }
        if (-not $backendHealthy) { Start-Sleep -Seconds 1 }
    } while (-not $backendHealthy -and [DateTime]::UtcNow -lt $healthDeadline)
    if (-not $backendHealthy) {
        throw 'Backend health check failed during startup. Inspect .beacon-dev/backend.err.log.'
    }

    $trackedProcesses = @(
        if ($backend) { @{ name = 'backend'; pid = $backend.Id; port = 3000; owned = $true } }
        elseif ($reusePorts[3000]) {
            @{
                name = 'backend'
                pid = if ($reuseOwnerPids[3000]) { $reuseOwnerPids[3000] } else { $reusePorts[3000].Pid }
                port = 3000
                owned = [bool]$reuseOwnerPids[3000]
            }
        }
        if ($viewer) { @{ name = 'web-viewer'; pid = $viewer.Id; port = 5173; owned = $true } }
        elseif ($reusePorts[5173]) {
            @{
                name = 'web-viewer'
                pid = if ($reuseOwnerPids[5173]) { $reuseOwnerPids[5173] } else { $reusePorts[5173].Pid }
                port = 5173
                owned = [bool]$reuseOwnerPids[5173]
            }
        }
    )
    @{
        commands = @{
            androidInstall = '.\scripts\Build-Install-BeaconAndroidDebug.ps1'
            test = '.\scripts\Test-BeaconLanDev.ps1'
        }
        lanHost = $LanHost
        logs = @{
            backend = (Join-Path $stateDirectory 'backend.out.log')
            viewer = (Join-Path $stateDirectory 'viewer.out.log')
        }
        ports = @{ api = 3000; https = 8443; turn = 3478; viewer = 5173 }
        processes = $trackedProcesses
        repositoryPath = $repositoryRoot
        startTime = [DateTimeOffset]::Now.ToString('o')
        urls = @{
            apiHealth = "$httpsOrigin/health"
            browserCamera = "$httpsOrigin/camera-mode"
            dashboard = $httpsOrigin
            monitor = "$httpsOrigin/monitor"
            signaling = "wss://${LanHost}:8443/api/signaling"
        }
    } | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $statePath
} catch {
    if ($backend -and -not $backend.HasExited) { & taskkill.exe /PID $backend.Id /T /F *> $null }
    if ($viewer -and -not $viewer.HasExited) { & taskkill.exe /PID $viewer.Id /T /F *> $null }
    & docker compose -f infrastructure/docker/compose.yaml --profile secure down
    throw
}

Write-Host "Beacon LAN development is ready."
Write-Host "Browser and phone URL: $httpsOrigin"
Write-Host "Dashboard: $httpsOrigin"
Write-Warning 'LAN mode listens on every network address and uses the published development TURN secret. Anyone on this network can reach the services and obtain relay credentials while it runs. Use it only on a network you trust, and stop it when you are done.'
Write-Host "Monitor: $httpsOrigin/monitor"
Write-Host "Cameras: $httpsOrigin/cameras"
Write-Host "Devices: $httpsOrigin/devices"
Write-Host "Browser Camera: $httpsOrigin/camera-mode"
Write-Host "Diagnostics: $httpsOrigin/diagnostics"
Write-Host "API health: $httpsOrigin/health"
Write-Host "Signaling: wss://${LanHost}:8443/api/signaling"
Write-Host "STUN: stun:${LanHost}:3478"
Write-Host "TURN: ${LanHost}:3478 (relay UDP $TurnMinPort-$TurnMaxPort)"
Write-Host "Android API endpoint: $httpsOrigin"
Write-Host "Logs: $stateDirectory"
Write-Host "Android install: .\scripts\Build-Install-BeaconAndroidDebug.ps1 -LanHost $LanHost"
Write-Host "Export the CA: .\scripts\Export-BeaconDevCertificate.ps1"
Write-Host "Validate: .\scripts\Test-BeaconLanDev.ps1"
Write-Host "LAN check: .\scripts\Test-BeaconLanDev.ps1 -LanHost $LanHost"
