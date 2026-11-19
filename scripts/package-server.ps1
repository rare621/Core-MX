$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectDir 'dist'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$serverSource = Get-Content -LiteralPath (Join-Path $projectDir 'server\mxbm-server.js') -Raw
$versionMatch = [regex]::Match($serverSource, 'const VERSION = (\d+);')
if (-not $versionMatch.Success) { throw 'Could not read online service version' }
$archiveName = "CoreMX-server-v$($versionMatch.Groups[1].Value).zip"
$serverFiles = @('mxbm-server.js', 'cache-cleanup.js', 'coremx-website-proxy.js', 'start-server.cmd', 'open-firewall.cmd', 'README.md') | ForEach-Object { Join-Path $projectDir "server\$_" }
Compress-Archive -LiteralPath $serverFiles -DestinationPath (Join-Path $outputDir $archiveName) -Force
Write-Output 'Packaged the online service (source and launchers only; no accounts or shared files)'
