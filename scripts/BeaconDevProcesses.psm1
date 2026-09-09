function Get-BeaconListener {
    param([Parameter(Mandatory)][int]$Port)
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($listener) {
        $address = $listener.LocalAddress
        $processId = [int]$listener.OwningProcess
    } else {
        $netstat = & netstat.exe -ano -p tcp |
            Select-String "^\s*TCP\s+(\S+):$Port\s+\S+\s+LISTENING\s+(\d+)\s*$" |
            Select-Object -First 1
        if (-not $netstat) { return $null }
        $match = [regex]::Match(
            $netstat.Line,
            "^\s*TCP\s+(\S+):$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
        )
        $address = $match.Groups[1].Value
        $processId = [int]$match.Groups[2].Value
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" `
        -ErrorAction SilentlyContinue
    $fallback = Get-Process -Id $processId -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Address = $address
        CommandLine = $process.CommandLine
        ExecutablePath = if ($process.ExecutablePath) { $process.ExecutablePath } else { $fallback.Path }
        Name = if ($process.Name) { $process.Name } else { $fallback.ProcessName }
        Pid = $processId
        Port = $Port
    }
}

function Test-BeaconProcess {
    param(
        [Parameter(Mandatory)]$Process,
        [Parameter(Mandatory)][string]$RepositoryRoot
    )
    if (-not $Process.CommandLine) { return $false }
    $normalizedRoot = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\')
    return $Process.CommandLine.IndexOf(
        $normalizedRoot,
        [StringComparison]::OrdinalIgnoreCase
    ) -ge 0 -and $Process.CommandLine -match '(beacon|pnpm|vite|tsx)'
}

function Read-BeaconDevState {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Remove-StaleBeaconDevState {
    param([Parameter(Mandatory)][string]$Path)
    $state = Read-BeaconDevState $Path
    if (-not $state) {
        if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
        return
    }
    $trackedPids = @($state.processes | ForEach-Object { $_.pid }) +
        @($state.backendPid, $state.viewerPid)
    $alive = @($trackedPids | Where-Object {
        $_ -and (Get-Process -Id $_ -ErrorAction SilentlyContinue)
    })
    if ($alive.Count -eq 0) { Remove-Item -LiteralPath $Path -Force }
}

function Stop-BeaconTrackedProcess {
    param(
        [Parameter(Mandatory, Position = 0)][int]$ProcessId,
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [switch]$TrustedState
    )
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" `
        -ErrorAction SilentlyContinue
    if (-not $process) { return }
    $candidate = [pscustomobject]@{
        CommandLine = $process.CommandLine
        ExecutablePath = $process.ExecutablePath
        Name = $process.Name
        Pid = $ProcessId
    }
    $validTrackedCommand =
        $TrustedState -and
        $candidate.Name -match '^(cmd|node|pnpm)(\.exe)?$' -and
        $candidate.CommandLine -match '(pnpm|vite|tsx)'
    if (-not $validTrackedCommand -and -not (Test-BeaconProcess $candidate $RepositoryRoot)) {
        throw "Refusing to stop PID $ProcessId because it is not owned by this Beacon repository."
    }
    & taskkill.exe /PID $ProcessId /T /F *> $null
}

function Format-BeaconProcess {
    param([Parameter(Mandatory)]$Process)
    "PID: $($Process.Pid)`nProcess: $($Process.Name)`nExecutable: $($Process.ExecutablePath)`nCommand: $($Process.CommandLine)`nListening: $($Process.Address):$($Process.Port)"
}

Export-ModuleMember -Function Get-BeaconListener, Test-BeaconProcess, `
    Read-BeaconDevState, Remove-StaleBeaconDevState, `
    Stop-BeaconTrackedProcess, Format-BeaconProcess
