$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectDir 'dist'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$serverFiles = @('mxbm-server.js', 'cache-cleanup.js', 'start-server.cmd', 'open-firewall.cmd', 'README.md') | ForEach-Object { Join-Path $projectDir "server\$_" }
Compress-Archive -LiteralPath $serverFiles -DestinationPath (Join-Path $outputDir 'mxbm-online-service.zip') -Force
Write-Output 'Packaged the online service (source and launchers only; no accounts or shared files)'
