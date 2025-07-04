Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/tm-LBenson/big-log-viewer.git"
$appName = "biglog.exe"
$desktopPath = [Environment]::GetFolderPath("Desktop")

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git not found. Installing via winget..."
    winget install --id Git.Git -e --source winget
}

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Host "Go not found. Installing via winget..."
    winget install --id GoLang.Go -e --source winget
}

$tempPath = "$env:TEMP\biglog_temp"
if (Test-Path $tempPath) { Remove-Item -Recurse -Force $tempPath }
git clone $repoUrl $tempPath

Push-Location $tempPath
go build -o $appName
Pop-Location

Move-Item "$tempPath\$appName" "$desktopPath\$appName" -Force

Remove-Item -Recurse -Force $tempPath

Write-Host "$appName has been built and moved to your Desktop."
