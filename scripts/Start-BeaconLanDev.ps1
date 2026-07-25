[CmdletBinding()]
param(
    [string]$LanHost,
    [ValidateRange(1024, 65535)]
    [int]$TurnMinPort = 49160,
    [ValidateRange(1024, 65535)]
    [int]$TurnMaxPort = 49200,
    [switch]$SkipAdbCheck
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot

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

function Assert-TcpPortAvailable([int]$Port) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, $Port)
    try {
        $listener.Start()
    } catch {
        throw "TCP port $Port is occupied. Stop the existing process and retry."
    } finally {
        $listener.Stop()
    }
}

function Assert-UdpPortAvailable([int]$Port) {
    $client = [Net.Sockets.UdpClient]::new()
    try {
        $client.Client.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Any, $Port))
    } catch {
        throw "UDP port $Port is occupied. Stop the existing process and retry."
    } finally {
        $client.Dispose()
    }
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

foreach ($port in @(3000, 5173, 8443, 3478)) {
    Assert-TcpPortAvailable $port
}
foreach ($port in (@(3478) + ($TurnMinPort..$TurnMaxPort))) {
    Assert-UdpPortAvailable $port
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

$stateDirectory = Join-Path $repositoryRoot '.beacon-dev'
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
$statePath = Join-Path $stateDirectory 'lan-dev.json'
if (Test-Path $statePath) {
    throw "LAN development state already exists at $statePath. Run Stop-BeaconLanDev.ps1 first."
}

try {
    & docker compose -f infrastructure/docker/compose.yaml --profile secure up -d --force-recreate
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Compose startup failed.'
    }

    $backend = Start-Process -FilePath 'pnpm.cmd' `
        -ArgumentList @('--filter', '@beacon/backend', 'dev') `
        -WorkingDirectory $repositoryRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $stateDirectory 'backend.out.log') `
        -RedirectStandardError (Join-Path $stateDirectory 'backend.err.log') `
        -PassThru
    $viewer = Start-Process -FilePath 'pnpm.cmd' `
        -ArgumentList @('--filter', '@beacon/web-viewer', 'dev') `
        -WorkingDirectory $repositoryRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $stateDirectory 'viewer.out.log') `
        -RedirectStandardError (Join-Path $stateDirectory 'viewer.err.log') `
        -PassThru

    Start-Sleep -Seconds 2
    if ($backend.HasExited) {
        throw "Backend exited during startup. Inspect .beacon-dev/backend.err.log."
    }
    if ($viewer.HasExited) {
        throw "Vite exited during startup. Port 5173 is strict; inspect .beacon-dev/viewer.err.log."
    }

    @{
        backendPid = $backend.Id
        browserUrl = $httpsOrigin
        lanHost = $LanHost
        viewerPid = $viewer.Id
    } | ConvertTo-Json | Set-Content -Encoding utf8 $statePath
} catch {
    if ($backend -and -not $backend.HasExited) { & taskkill.exe /PID $backend.Id /T /F *> $null }
    if ($viewer -and -not $viewer.HasExited) { & taskkill.exe /PID $viewer.Id /T /F *> $null }
    & docker compose -f infrastructure/docker/compose.yaml --profile secure down
    throw
}

Write-Host "Beacon LAN development is starting."
Write-Host "Browser and phone URL: $httpsOrigin"
Write-Host "Android API endpoint: $httpsOrigin"
Write-Host "Export the CA: .\scripts\Export-BeaconDevCertificate.ps1"
Write-Host "Validate: .\scripts\Test-BeaconLanDev.ps1"
