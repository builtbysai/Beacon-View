[CmdletBinding()]
param(
    [ValidateSet('Dashboard', 'CameraMode')]
    [string]$Page = 'Dashboard'
)

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'BeaconDevProcesses.psm1') -Force
$state = Read-BeaconDevState (Join-Path $repositoryRoot '.beacon-dev\lan-dev.json')
if (-not $state) { throw 'Beacon LAN development is not running.' }
$url = if ($Page -eq 'CameraMode') { $state.urls.browserCamera } else { $state.urls.dashboard }
Start-Process $url
