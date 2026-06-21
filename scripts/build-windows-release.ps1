# Build RouteRich Windows installer zip for GitHub Releases.
param(
    [string]$Version = ""
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$WindowsDir = Join-Path $Root 'windows'
$VersionFile = Join-Path $Root 'VERSION'

if (-not $Version) {
    $Version = (Get-Content $VersionFile -Raw).Trim()
}

$OutName = "RouteRich-Windows-v$Version.zip"
$OutPath = Join-Path $Root $OutName
$Stage = Join-Path $env:TEMP "routerich-windows-release-$Version"

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage | Out-Null

$ExcludeDirs = @('tools', '__pycache__')
$ExcludeFiles = @('install.config.json', 'panel-install.json', 'panel-install-history.json')

Get-ChildItem -LiteralPath $WindowsDir -Force | ForEach-Object {
    if ($_.PSIsContainer) {
        if ($ExcludeDirs -contains $_.Name) { return }
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Stage $_.Name) -Recurse -Force
        return
    }
    if ($ExcludeFiles -contains $_.Name) { return }
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Stage $_.Name) -Force
}

Get-ChildItem -LiteralPath $Stage -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $Stage -Recurse -File -Filter '*.pyc' | Remove-Item -Force -ErrorAction SilentlyContinue

if (Test-Path $OutPath) { Remove-Item $OutPath -Force }
$ZipTemp = "$OutPath.partial.zip"
if (Test-Path $ZipTemp) { Remove-Item $ZipTemp -Force }
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $ZipTemp -CompressionLevel Optimal
Move-Item -LiteralPath $ZipTemp -Destination $OutPath -Force
Remove-Item $Stage -Recurse -Force

Write-Host "Built $OutName ($((Get-Item $OutPath).Length) bytes)"