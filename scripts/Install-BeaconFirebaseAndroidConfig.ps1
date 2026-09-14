[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$destinationPath = Join-Path $repositoryRoot 'apps\android-camera\app\google-services.json'
$expectedPackage = 'com.beaconsecureview.camera'

if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
    throw "Firebase configuration was not found at '$SourcePath'."
}

try {
    $configuration = Get-Content -Raw -LiteralPath $SourcePath | ConvertFrom-Json
} catch {
    throw "Firebase configuration is not valid JSON: $($_.Exception.Message)"
}

$projectId = [string]$configuration.project_info.project_id
$packageNames = @(
    $configuration.client |
        ForEach-Object { [string]$_.client_info.android_client_info.package_name }
)

if (-not $projectId) {
    throw 'Firebase configuration does not contain project_info.project_id.'
}
if ($expectedPackage -notin $packageNames) {
    throw "Firebase configuration is not registered for Android package '$expectedPackage'."
}

Copy-Item -LiteralPath $SourcePath -Destination $destinationPath -Force
$hash = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash

Write-Host "Installed ignored Firebase Android configuration for project '$projectId'."
Write-Host "Destination: $destinationPath"
Write-Host "SHA-256: $hash"
Write-Host 'No server credential was installed; google-services.json is Android client configuration.'
