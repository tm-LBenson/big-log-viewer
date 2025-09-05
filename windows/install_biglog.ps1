Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoUrl     = "https://github.com/tm-LBenson/big-log-viewer.git"
$appName     = "biglog.exe"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$tempPath    = Join-Path $env:TEMP "biglog_temp"

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Error "winget is required but not found. Please install Windows 10 1809+ or use the Microsoft Store version of 'App Installer'."
    exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Git..."
    winget install --id Git.Git -e --source winget
    Refresh-Path
    Start-Sleep -Seconds 3
}

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Go..."
    winget install --id GoLang.Go -e --source winget
    Refresh-Path
    Start-Sleep -Seconds 3
}

if (-not (Test-Path $tempPath)) {
    Write-Host "Cloning repository..."
    try {
        git clone --depth 1 "$repoUrl" "$tempPath"
    }
    catch {
        Write-Warning "First git clone attempt failed. Retrying in 5 seconds..."
        Start-Sleep -Seconds 5
        git clone --depth 1 "$repoUrl" "$tempPath"
    }
} else {
    Write-Host "Repo already cloned at $tempPath, skipping clone."
}

Push-Location $tempPath
go build -o $appName ./cmd/biglog
Pop-Location

Move-Item -Path (Join-Path $tempPath $appName) `
          -Destination (Join-Path $desktopPath $appName) -Force

Write-Host "`n Built and placed '$appName' on your Desktop."
Write-Host "   Run with: `"$desktopPath\$appName`" -logdir `"C:\path\to\logs`""
