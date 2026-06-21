# Shared helpers for RouteRich installer scripts

function Invoke-QuietPython {
    param(
        [Parameter(Mandatory = $true)][string]$PythonExe,
        [Parameter(Mandatory = $true)][string[]]$Args
    )
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        & $PythonExe @Args 2>$null | Out-Null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Test-PythonParamiko {
    param([Parameter(Mandatory = $true)][string]$PythonExe)
    if (-not (Test-Path -LiteralPath $PythonExe)) { return $false }
    $ok = (Invoke-QuietPython -PythonExe $PythonExe -Args @('-c', 'import paramiko; import cryptography')) -eq 0
    return $ok
}

function Install-Paramiko {
    param([Parameter(Mandatory = $true)][string]$PythonExe)
    Write-Host '>> Installing paramiko + cryptography...' -ForegroundColor Cyan
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $PythonExe -m pip install --upgrade pip paramiko cryptography bcrypt pynacl cffi --no-warn-script-location
        return $LASTEXITCODE -eq 0
    } finally {
        $ErrorActionPreference = $prev
    }
}

function Resolve-PythonInstaller {
    param([Parameter(Mandatory = $true)][string]$InstallerDir)

    $ReadyFile = Join-Path $InstallerDir 'tools\.ready'
    $Bundled = Join-Path $InstallerDir 'tools\python\python.exe'
    $candidates = @()

    if (Test-Path -LiteralPath $Bundled) {
        $candidates += $Bundled
    }
    if (Test-Path -LiteralPath $ReadyFile) {
        foreach ($line in Get-Content -LiteralPath $ReadyFile) {
            if ($line -match '^python=(.+)$') {
                $candidates += $Matches[1].Trim()
            }
        }
    }
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $exe = & py -3 -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $candidates += ($exe | Select-Object -First 1).Trim()
        }
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        $exe = & python -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $candidates += ($exe | Select-Object -First 1).Trim()
        }
    }

    $seen = @{}
    foreach ($candidate in $candidates) {
        if (-not $candidate -or $seen.ContainsKey($candidate)) { continue }
        $seen[$candidate] = $true
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        if (Test-PythonParamiko -PythonExe $candidate) {
            return $candidate
        }
    }

    foreach ($candidate in $candidates) {
        if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) { continue }
        if (Install-Paramiko -PythonExe $candidate) {
            if (Test-PythonParamiko -PythonExe $candidate) {
                return $candidate
            }
        }
    }

    return $null
}