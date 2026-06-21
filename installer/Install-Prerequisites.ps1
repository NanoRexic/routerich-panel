#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$InstallerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolsDir = Join-Path $InstallerDir 'tools'
$PythonDir = Join-Path $ToolsDir 'python'
$ReadyFile = Join-Path $ToolsDir '.ready'
$PythonVersion = '3.12.8'
$EmbedUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$GetPipUrl = 'https://bootstrap.pypa.io/get-pip.py'

function Write-Step([string]$Text) {
    Write-Host ">> $Text" -ForegroundColor Cyan
}

$Common = Join-Path $InstallerDir 'Installer-Common.ps1'
. $Common

function Find-SystemPython {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $exe = & py -3 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $exe = ($exe | Select-Object -First 1).Trim()
            if (Test-PythonParamiko $exe) { return $exe }
        }
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        $exe = & python -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $exe = ($exe | Select-Object -First 1).Trim()
            if (Test-PythonParamiko $exe) { return $exe }
        }
    }
    return $null
}

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Install-PortablePython {
    Ensure-Directory $ToolsDir
    $zipPath = Join-Path $ToolsDir 'python-embed.zip'
    $pythonExe = Join-Path $PythonDir 'python.exe'

    if (Test-PythonParamiko $pythonExe) {
        return $pythonExe
    }

    Write-Step "Downloading portable Python $PythonVersion..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $EmbedUrl -OutFile $zipPath -UseBasicParsing

    if (Test-Path -LiteralPath $PythonDir) {
        Remove-Item -LiteralPath $PythonDir -Recurse -Force
    }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $PythonDir -Force
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue

    $pthFile = Get-ChildItem -LiteralPath $PythonDir -Filter 'python*._pth' | Select-Object -First 1
    if ($pthFile) {
        $pth = Get-Content -LiteralPath $pthFile.FullName
        $pth = $pth | ForEach-Object { $_ -replace '^#import site', 'import site' }
        if ($pth -notcontains 'import site') { $pth += 'import site' }
        Set-Content -LiteralPath $pthFile.FullName -Value $pth -Encoding ASCII
    }

    $getPip = Join-Path $ToolsDir 'get-pip.py'
    Write-Step 'Installing pip...'
    Invoke-WebRequest -Uri $GetPipUrl -OutFile $getPip -UseBasicParsing
    & $pythonExe $getPip --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }

    Write-Step 'Installing paramiko + cryptography (required for OpenWrt SSH)...'
    & $pythonExe -m pip install --upgrade pip paramiko cryptography bcrypt pynacl cffi --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw 'paramiko install failed' }
    & $pythonExe -c "import paramiko; import cryptography" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'cryptography install failed' }

    if (-not (Test-PythonParamiko $pythonExe)) {
        throw 'paramiko is not available after install'
    }
    return $pythonExe
}

function Try-WingetPython {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return $null }
    Write-Step 'Trying winget Python install...'
    try {
        winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements | Out-Null
    } catch {
        return $null
    }
    Start-Sleep -Seconds 3
    return Find-SystemPython
}

function Write-ReadyFile([string]$PythonExe) {
    Ensure-Directory $ToolsDir
    "python=$PythonExe`ninstalled_at=$(Get-Date -Format o)" | Set-Content -LiteralPath $ReadyFile -Encoding UTF8
}

Write-Host ''
Write-Host '=== RouteRich: install PC dependencies ===' -ForegroundColor Green
Write-Host ''

$python = Find-SystemPython
if ($python) {
    Write-Step "Found Python with paramiko: $python"
} else {
    Write-Step 'Python/paramiko not found, setting up...'
    $python = Try-WingetPython
    if (-not $python) {
        $python = Install-PortablePython
    } else {
        Write-Step 'Installing paramiko + cryptography into system Python...'
        & $python -m pip install --upgrade pip paramiko cryptography bcrypt pynacl cffi --no-warn-script-location
        if (-not (Test-PythonParamiko $python)) { throw 'paramiko install failed' }
    }
}

Write-ReadyFile $python

Write-Host ''
Write-Host 'Done. Dependencies are ready.' -ForegroundColor Green
Write-Host "Python: $python"
Write-Host ''
Write-Host 'Next step: run step 2 batch file (2-*.bat)' -ForegroundColor Yellow
Write-Host ''