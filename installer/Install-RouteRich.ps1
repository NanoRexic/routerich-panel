#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$InstallerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallPy = Join-Path $InstallerDir 'install.py'
$Common = Join-Path $InstallerDir 'Installer-Common.ps1'

. $Common

Write-Host ''
Write-Host '=== RouteRich: install panel on router ===' -ForegroundColor Green
Write-Host ''

$python = Resolve-PythonInstaller -InstallerDir $InstallerDir
if (-not $python) {
    Write-Host 'Python with paramiko not found.' -ForegroundColor Red
    Write-Host 'Run step 1 first: 1-*.bat (Install-Prerequisites)' -ForegroundColor Yellow
    exit 2
}

Write-Host "Using Python: $python" -ForegroundColor DarkGray
& $python $InstallPy @args
exit $LASTEXITCODE