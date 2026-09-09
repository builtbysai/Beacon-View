[CmdletBinding()]
param(
    [switch]$SkipDependencyInstall,
    [switch]$SkipMigration,
    [switch]$NoDockerStart,
    [switch]$SkipDockerServices
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot

function Assert-BeaconCommand([string]$Name, [string]$Guidance) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' is unavailable. $Guidance"
    }
}

Assert-BeaconCommand 'node' 'Install Node.js 22.13 or newer within Node 22.'
Assert-BeaconCommand 'pnpm.cmd' 'Run: corepack enable; corepack prepare pnpm@11.9.0 --activate'
if (-not $SkipDockerServices) {
    Assert-BeaconCommand 'docker' 'Install and start Docker Desktop.'
}

function Get-BeaconDockerEngineStatus {
    $dockerCommand = Get-Command docker -ErrorAction Stop
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $dockerCommand.Source
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    # ProcessStartInfo.ArgumentList is unavailable in Windows PowerShell 5.1.
    # Arguments keeps the launcher compatible with both powershell.exe and pwsh.
    $startInfo.Arguments = 'info --format "{{.ServerVersion}}"'
    $probe = [Diagnostics.Process]::new()
    $probe.StartInfo = $startInfo
    try {
        [void]$probe.Start()
        $outputTask = $probe.StandardOutput.ReadToEndAsync()
        $errorTask = $probe.StandardError.ReadToEndAsync()
        if (-not $probe.WaitForExit(10000)) {
            # Kill(Boolean) is unavailable on Windows PowerShell 5.1/.NET Framework.
            $probe.Kill()
            $probe.WaitForExit()
            return [pscustomobject]@{
                Ready = $false
                Detail = 'The Docker server did not respond within 10 seconds.'
            }
        }
        $standardOutput = $outputTask.GetAwaiter().GetResult().Trim()
        $standardError = $errorTask.GetAwaiter().GetResult().Trim()
        return [pscustomobject]@{
            Ready = $probe.ExitCode -eq 0 -and [bool]$standardOutput
            Detail = if ($standardError) { $standardError } else { $standardOutput }
        }
    } finally {
        $probe.Dispose()
    }
}

function Format-BeaconDockerGuidance([string]$Detail) {
    if ($Detail -match 'permission denied|Access is denied') {
        return 'Docker is running, but this Windows account cannot access its engine. Close and reopen PowerShell after Docker Desktop finishes updating. If it persists, add this account to the local docker-users group, sign out of Windows, and sign back in.'
    }
    if ($Detail -match 'config\.json') {
        return 'Docker could not read the current account configuration. Check access to the .docker folder in your Windows profile, then restart Docker Desktop.'
    }
    if ($Detail -match 'pipe/docker_engine|cannot connect|connection refused|daemon') {
        return 'Docker Desktop is open, but its engine is not ready. Wait for Docker Desktop to show Engine running, then retry.'
    }
    return 'Docker Desktop is installed, but its engine is not ready. Open Docker Desktop, wait for Engine running, then retry.'
}

$nodeVersion = (& node --version).TrimStart('v')
if ([version]$nodeVersion -lt [version]'22.13.0' -or [version]$nodeVersion -ge [version]'23.0.0') {
    throw "Node >=22.13.0 <23 is required; found v$nodeVersion."
}
if ((& pnpm.cmd --version).Trim() -ne '11.9.0') {
    throw "pnpm 11.9.0 is required; found $((& pnpm.cmd --version).Trim())."
}
$dockerStatus = if (-not $SkipDockerServices) { Get-BeaconDockerEngineStatus } else { $null }
if (-not $SkipDockerServices -and -not $dockerStatus.Ready -and -not $NoDockerStart) {
    $dockerCandidates = @('C:\Program Files\Docker\Docker\Docker Desktop.exe')
    if ($env:LOCALAPPDATA) {
        $dockerCandidates += Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe'
    }
    $dockerDesktop = $dockerCandidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    if ($dockerDesktop) {
        $desktopProcess = Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue
        if ($desktopProcess) {
            Write-Host 'Docker Desktop is already open; waiting for its engine...'
            $dockerDeadline = [DateTime]::UtcNow.AddSeconds(90)
        } else {
            Write-Host 'Docker Desktop is installed but not running; starting it...'
            Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
            $dockerDeadline = [DateTime]::UtcNow.AddMinutes(5)
        }
        $lastProgress = [DateTime]::UtcNow
        do {
            Start-Sleep -Seconds 3
            $dockerStatus = Get-BeaconDockerEngineStatus
            if ($dockerStatus.Ready) { break }
            if (([DateTime]::UtcNow - $lastProgress).TotalSeconds -ge 15) {
                $remaining = [math]::Max(0, [math]::Ceiling(($dockerDeadline - [DateTime]::UtcNow).TotalSeconds))
                Write-Host "Docker engine is not responding yet ($remaining seconds remaining)..."
                $lastProgress = [DateTime]::UtcNow
            }
        } while ([DateTime]::UtcNow -lt $dockerDeadline)
    } else {
        throw 'Docker is required but Docker Desktop was not found. Install Docker Desktop, then run this command again.'
    }
}
if (-not $SkipDockerServices -and -not $dockerStatus.Ready) {
    $guidance = Format-BeaconDockerGuidance $dockerStatus.Detail
    $detail = if ($dockerStatus.Detail) { " Docker reported: $($dockerStatus.Detail)" } else { '' }
    throw "$guidance$detail"
}

$backendEnvironment = Join-Path $repositoryRoot 'apps\backend\.env'
if (-not (Test-Path -LiteralPath $backendEnvironment)) {
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'apps\backend\.env.example') `
        -Destination $backendEnvironment
    Write-Host 'Created apps/backend/.env from the local-development example.'
}

if (-not $SkipDependencyInstall) {
    Write-Host 'Installing the pinned Node dependencies...'
    & pnpm.cmd install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}

if (-not $SkipDockerServices) {
    Write-Host 'Starting local PostgreSQL and TURN services...'
    & docker compose -f infrastructure/docker/compose.yaml up -d postgres coturn
    if ($LASTEXITCODE -ne 0) { throw 'Docker service startup failed.' }

    $postgresId = (& docker compose -f infrastructure/docker/compose.yaml ps -q postgres).Trim()
    if (-not $postgresId) { throw 'PostgreSQL did not start.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
        $health = (& docker inspect --format '{{.State.Health.Status}}' $postgresId).Trim()
        if ($health -eq 'healthy') { break }
        if ($health -eq 'unhealthy') { throw 'PostgreSQL reported an unhealthy state.' }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($health -ne 'healthy') { throw 'PostgreSQL did not become healthy within 60 seconds.' }
}

if (-not $SkipMigration -and -not $SkipDockerServices) {
    Write-Host 'Applying database migrations...'
    & pnpm.cmd --filter @beacon/backend db:migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
}

Write-Host 'Beacon local development is initialized.'
