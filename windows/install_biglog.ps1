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

function Assert-LastExitCode {
    param([string]$Step)
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget is required but not found. Please install App Installer first."
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Git..."
    winget install --id Git.Git -e --source winget
    Assert-LastExitCode "Installing Git"
    Refresh-Path
    Start-Sleep -Seconds 3
}

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Go..."
    winget install --id GoLang.Go -e --source winget
    Assert-LastExitCode "Installing Go"
    Refresh-Path
    Start-Sleep -Seconds 3
}

$goModPath = Join-Path $tempPath "go.mod"
$gitPath = Join-Path $tempPath ".git"
if ((Test-Path $tempPath) -and -not ((Test-Path $goModPath) -and (Test-Path $gitPath))) {
    Remove-Item $tempPath -Recurse -Force
}

if (-not (Test-Path $tempPath)) {
    Write-Host "Cloning repository..."
    git clone --depth 1 "$repoUrl" "$tempPath"
    Assert-LastExitCode "Cloning repository"
} else {
    Write-Host "Refreshing repository..."
    git -C $tempPath fetch origin
    Assert-LastExitCode "Fetching repository"
    git -C $tempPath reset --hard origin/main
    Assert-LastExitCode "Resetting repository"
    git -C $tempPath clean -fd
    Assert-LastExitCode "Cleaning repository"
}

$packageVersion = (Get-Content (Join-Path $tempPath "package.json") | ConvertFrom-Json).version
if (-not $packageVersion) {
    throw "Could not read version from package.json"
}

Push-Location $tempPath
try {
    go build -ldflags "-X main.appVersion=$packageVersion" -o $appName ./cmd/biglog
    Assert-LastExitCode "Building biglog"
}
finally {
    Pop-Location
}

$builtExe = Join-Path $tempPath $appName
if (-not (Test-Path $builtExe)) {
    throw "Build completed without producing $builtExe"
}

$targetExe = Join-Path $desktopPath $appName
Move-Item -Path $builtExe -Destination $targetExe -Force

$metaPath = Join-Path $desktopPath "biglog-install.json"
@{
    repoUrl       = $repoUrl
    installScript = "windows/install_biglog.ps1"
    installedAt   = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -Path $metaPath -Encoding UTF8

Write-Host ""
Write-Host "Built and placed '$appName' on your Desktop."
Write-Host "Version: $packageVersion"
Write-Host "Run with: `"$desktopPath\$appName`" -logdir `"C:\path\to\logs`""
