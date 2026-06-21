#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$InstallerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$UninstallPy = Join-Path $InstallerDir 'uninstall.py'
$Common = Join-Path $InstallerDir 'Installer-Common.ps1'

. $Common

$python = Resolve-PythonInstaller -InstallerDir $InstallerDir
if (-not $python) {
    Write-Host 'Python with paramiko not found.' -ForegroundColor Red
    Write-Host 'Run step 1 first: 1-*.bat (Install-Prerequisites)' -ForegroundColor Yellow
    exit 2
}

& $python $UninstallPy @args
exit $LASTEXITCODE