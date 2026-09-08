[CmdletBinding()]
param(
    [string]$LanHost,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Continue'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot
$failures = [Collections.Generic.List[string]]::new()

function Invoke-Check([string]$Name, [scriptblock]$Action) {
    Write-Host "`n[$Name]"
    try {
        # Pure PowerShell checks do not set LASTEXITCODE. Reset it so they cannot
        # inherit a null or stale value from a command that ran before this check.
        $global:LASTEXITCODE = 0
        & $Action
        if ($global:LASTEXITCODE -ne 0) {
            throw "Exited with code $global:LASTEXITCODE."
        }
        Write-Host "PASS: $Name"
    } catch {
        $failures.Add("${Name}: $($_.Exception.Message)")
        Write-Host "FAIL: $Name - $($_.Exception.Message)"
    }
}

if (-not $LanHost) {
    $statePath = Join-Path $repositoryRoot '.beacon-dev\lan-dev.json'
    if (Test-Path -LiteralPath $statePath) {
        $LanHost = (Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json).lanHost
    }
}

Invoke-Check 'PowerShell syntax' {
    Get-ChildItem -LiteralPath scripts -Filter '*.ps1' | ForEach-Object {
        $tokens = $null
        $errors = $null
        [Management.Automation.Language.Parser]::ParseFile(
            $_.FullName,
            [ref]$tokens,
            [ref]$errors
        ) | Out-Null
        if ($errors.Count -gt 0) {
            throw "$($_.Name): $($errors[0].Message)"
        }
    }
}
Invoke-Check 'Test database guard' {
    & pnpm.cmd --filter @beacon/backend test -- test/test-database.test.ts
}
if (-not $SkipBuild) {
    Invoke-Check 'Formatting, lint, types, tests, and builds' { & pnpm.cmd check }
}
Invoke-Check 'Repository diff integrity' { & git diff --check }

if ($LanHost) {
    Invoke-Check 'HTTPS, WSS, STUN, and LAN routes' {
        & (Join-Path $PSScriptRoot 'Test-BeaconLanDev.ps1') -LanHost $LanHost
    }
    Invoke-Check 'Authenticated TURN allocation and relay traffic' {
        & (Join-Path $PSScriptRoot 'Test-BeaconTurnRelay.ps1') -LanHost $LanHost
    }
} else {
    $failures.Add('LAN runtime: pass -LanHost or start Beacon LAN development first')
}

Write-Host "`nManual checks still required:"
Write-Host '- Android install/pairing and Wi-Fi loss/restoration on a physical handset'
Write-Host '- Real browser webcam publication and permission revocation'
Write-Host '- Two or more real viewers with advancing video'
Write-Host '- Multiple physical camera sources and sibling switching'
Write-Host '- A forced-relay WebRTC session that reports a relay candidate'

if ($failures.Count -gt 0) {
    Write-Host "`nFunctional milestone validation failed:"
    $failures | ForEach-Object { Write-Host "- $_" }
    exit 1
}
Write-Host "`nAll automated functional milestone checks passed."
