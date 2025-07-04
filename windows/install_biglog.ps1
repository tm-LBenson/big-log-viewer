Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoUrl     = "https://github.com/tm-LBenson/big-log-viewer.git"
$appName     = "biglog.exe"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$tempPath    = Join-Path $env:TEMP "biglog_temp"

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Error "winget is required but not found. Please install Windows 10 1809+ or use the Microsoft Store version of 'App Installer'."
    exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Git..."
    winget install --id Git.Git -e --source winget
}

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Go..."
    winget install --id GoLang.Go -e --source winget
}

if (Test-Path $tempPath) { Remove-Item -Recurse -Force $tempPath }
git clone --depth 1 $repoUrl $tempPath

Push-Location $tempPath
go build -o $appName ./cmd/biglog
Pop-Location

Move-Item -Path (Join-Path $tempPath $appName) `
          -Destination (Join-Path $desktopPath $appName) -Force

Remove-Item -Recurse -Force $tempPath

Write-Host "`n Built and placed '$appName' on your Desktop."
Write-Host "   Run with: `"$desktopPath\$appName`" -logdir `"C:\path\to\logs`""
