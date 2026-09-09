[CmdletBinding()]
param(
    [switch]$SkipDatabaseIntegration,
    [switch]$SkipAndroid
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repositoryRoot

& (Join-Path $PSScriptRoot 'Initialize-BeaconDev.ps1') `
    -SkipDependencyInstall `
    -SkipMigration:$SkipDatabaseIntegration `
    -SkipDockerServices:$SkipDatabaseIntegration

Write-Host 'Running formatting, lint, types, unit tests, and production builds...'
& pnpm.cmd check
if ($LASTEXITCODE -ne 0) { throw 'The TypeScript workspace validation failed.' }

if (-not $SkipDatabaseIntegration) {
    $postgresOutput = @(& docker compose -f infrastructure/docker/compose.yaml ps -q postgres)
    $postgresId = [Convert]::ToString(($postgresOutput | Select-Object -First 1)).Trim()
    if (-not $postgresId) { throw 'PostgreSQL is not running.' }
    $databaseName = 'beacon_secureview_test'
    $existsOutput = @(& docker exec $postgresId psql -U beacon_local -d postgres -tAc `
        "SELECT 1 FROM pg_database WHERE datname='$databaseName'")
    $exists = [Convert]::ToString(($existsOutput | Select-Object -First 1)).Trim()
    if ($exists -ne '1') {
        & docker exec $postgresId createdb -U beacon_local $databaseName
        if ($LASTEXITCODE -ne 0) { throw 'The dedicated test database could not be created.' }
    }

    $testDatabaseUrl = `
        'postgresql://beacon_local:local-development-only@127.0.0.1:5432/beacon_secureview_test'
    $developmentDatabaseUrl = $env:DATABASE_URL
    $previousNodeEnvironment = $env:NODE_ENV
    $previousTestDatabaseUrl = $env:TEST_DATABASE_URL
    try {
        $env:NODE_ENV = 'test'
        $env:TEST_DATABASE_URL = $testDatabaseUrl
        $env:DATABASE_URL = $testDatabaseUrl
        Write-Host 'Migrating the dedicated _test database...'
        & pnpm.cmd --filter @beacon/backend db:migrate
        if ($LASTEXITCODE -ne 0) { throw 'Test database migration failed.' }
        $env:DATABASE_URL = $developmentDatabaseUrl
        Write-Host 'Running backend integration tests against beacon_secureview_test...'
        & pnpm.cmd --filter @beacon/backend test
        if ($LASTEXITCODE -ne 0) { throw 'Backend integration tests failed.' }
    } finally {
        $env:DATABASE_URL = $developmentDatabaseUrl
        $env:NODE_ENV = $previousNodeEnvironment
        $env:TEST_DATABASE_URL = $previousTestDatabaseUrl
    }
}

if (-not $SkipAndroid) {
    function Resolve-BeaconJavaHome {
        if ($env:JAVA_HOME -and
            (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
            return $env:JAVA_HOME
        }
        foreach ($candidate in @(
            'C:\Program Files\Android\Android Studio\jbr',
            'C:\Program Files\Android\Android Studio\jre'
        )) {
            if (Test-Path -LiteralPath (Join-Path $candidate 'bin\java.exe')) {
                return $candidate
            }
        }
        throw 'JDK 17 was not found. Install Android Studio or set JAVA_HOME.'
    }
    $env:JAVA_HOME = Resolve-BeaconJavaHome
    $androidBuildRoot = Join-Path $env:LOCALAPPDATA 'BeaconSecureView\android-build'
    Write-Host 'Running Android unit tests, lint, and debug/unsigned release builds...'
    & apps\android-camera\gradlew.bat -p apps/android-camera `
        "-PbeaconBuildDir=$androidBuildRoot" testDebugUnitTest lintDebug assembleDebug assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Android validation failed.' }
}

Write-Host 'All requested Beacon validation passed.'
