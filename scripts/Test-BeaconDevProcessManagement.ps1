[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'BeaconDevProcesses.psm1') -Force

$beacon = [pscustomobject]@{
    Address = '127.0.0.1'
    CommandLine = "node $repositoryRoot\node_modules\vite"
    ExecutablePath = 'C:\nvm4w\nodejs\node.exe'
    Name = 'node.exe'
    Pid = 1234
    Port = 5173
}
$unrelated = [pscustomobject]@{
    Address = '127.0.0.1'
    CommandLine = 'node C:\unrelated\server.js'
    ExecutablePath = 'C:\nvm4w\nodejs\node.exe'
    Name = 'node.exe'
    Pid = 5678
    Port = 3000
}
if (-not (Test-BeaconProcess $beacon $repositoryRoot)) {
    throw 'Beacon process ownership detection failed.'
}
if (Test-BeaconProcess $unrelated $repositoryRoot) {
    throw 'Unrelated process was incorrectly classified as Beacon.'
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) "beacon-state-$([guid]::NewGuid()).json"
try {
    '{"processes":[{"pid":2147483647}]}' | Set-Content -Encoding utf8 $temporary
    Remove-StaleBeaconDevState $temporary
    if (Test-Path -LiteralPath $temporary) {
        throw 'Stale state was not cleaned.'
    }
} finally {
    if (Test-Path -LiteralPath $temporary) {
        Remove-Item -LiteralPath $temporary -Force
    }
}

Write-Host 'Beacon development process-management checks passed.'
