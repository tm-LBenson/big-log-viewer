package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"
)

const defaultUpdateRepo = "https://github.com/tm-LBenson/big-log-viewer.git"

var (
	updater    = newUpdateManager()
	appVersion = "dev"
)

type installMetadata struct {
	RepoURL       string `json:"repoUrl,omitempty"`
	InstallScript string `json:"installScript,omitempty"`
	InstalledAt   string `json:"installedAt,omitempty"`
}

type updateStatus struct {
	State             string `json:"state"`
	Message           string `json:"message,omitempty"`
	Error             string `json:"error,omitempty"`
	RepoURL           string `json:"repoUrl,omitempty"`
	Executable        string `json:"executable,omitempty"`
	GOOS              string `json:"goos,omitempty"`
	CurrentVersion    string `json:"currentVersion,omitempty"`
	LatestVersion     string `json:"latestVersion,omitempty"`
	CurrentRevision   string `json:"currentRevision,omitempty"`
	CurrentShort      string `json:"currentShort,omitempty"`
	CurrentModified   bool   `json:"currentModified,omitempty"`
	LatestRevision    string `json:"latestRevision,omitempty"`
	LatestShort       string `json:"latestShort,omitempty"`
	UpdateAvailable   bool   `json:"updateAvailable"`
	CanCheck          bool   `json:"canCheck"`
	CanApply          bool   `json:"canApply"`
	UnsupportedReason string `json:"unsupportedReason,omitempty"`
	CheckedAt         string `json:"checkedAt,omitempty"`
	InstallScript     string `json:"installScript,omitempty"`
	InstalledAt       string `json:"installedAt,omitempty"`
}

type remoteBuildInfo struct {
	Version  string
	Revision string
}

type updateManager struct {
	mu     sync.RWMutex
	status updateStatus
	busy   bool
}

func newUpdateManager() *updateManager {
	m := &updateManager{}
	m.status = buildBaseUpdateStatus()
	m.status.State = "idle"
	m.status.Message = "Ready to check for updates."
	return m
}

func (m *updateManager) snapshot() updateStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := m.status
	if strings.TrimSpace(out.State) == "" {
		out.State = "idle"
	}
	return out
}

func (m *updateManager) reset(state, message string) updateStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	latestVersion := m.status.LatestVersion
	latestRevision := m.status.LatestRevision
	latestShort := m.status.LatestShort
	checkedAt := m.status.CheckedAt
	m.status = buildBaseUpdateStatus()
	m.status.State = state
	m.status.Message = message
	m.status.LatestVersion = latestVersion
	m.status.LatestRevision = latestRevision
	m.status.LatestShort = latestShort
	m.status.CheckedAt = checkedAt
	m.status.UpdateAvailable = isVersionNewer(m.status.CurrentVersion, latestVersion)
	return m.status
}

func (m *updateManager) updateLatest(info remoteBuildInfo) updateStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.status = buildBaseUpdateStatus()
	m.status.State = "checked"
	m.status.LatestVersion = info.Version
	m.status.LatestRevision = info.Revision
	m.status.LatestShort = shortHash(info.Revision)
	m.status.CheckedAt = time.Now().Format(time.RFC3339)
	if info.Version == "" {
		m.status.Message = "Could not determine the latest remote version."
		return m.status
	}

	switch versionCompare(m.status.CurrentVersion, info.Version) {
	case -1:
		m.status.UpdateAvailable = true
		if m.status.CurrentVersion == "" {
			m.status.Message = fmt.Sprintf("Update available: %s", info.Version)
		} else {
			m.status.Message = fmt.Sprintf("Update available: %s -> %s", m.status.CurrentVersion, info.Version)
		}
	case 0:
		m.status.UpdateAvailable = false
		m.status.Message = fmt.Sprintf("You are already on version %s.", info.Version)
	default:
		m.status.UpdateAvailable = false
		m.status.Message = fmt.Sprintf("You are already ahead of the latest remote version (%s).", info.Version)
	}
	return m.status
}

func (m *updateManager) markError(message string, err error) updateStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	latestVersion := m.status.LatestVersion
	latestRevision := m.status.LatestRevision
	latestShort := m.status.LatestShort
	checkedAt := m.status.CheckedAt
	m.status = buildBaseUpdateStatus()
	m.status.State = "error"
	m.status.Message = message
	m.status.Error = strings.TrimSpace(errString(err))
	m.status.LatestVersion = latestVersion
	m.status.LatestRevision = latestRevision
	m.status.LatestShort = latestShort
	m.status.CheckedAt = checkedAt
	m.status.UpdateAvailable = isVersionNewer(m.status.CurrentVersion, latestVersion)
	return m.status
}

func (m *updateManager) beginInstall() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.busy {
		return false
	}
	m.busy = true
	m.status = buildBaseUpdateStatus()
	m.status.State = "preparing"
	m.status.Message = "Preparing the update..."
	return true
}

func (m *updateManager) setProgress(state, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	latestVersion := m.status.LatestVersion
	latestRevision := m.status.LatestRevision
	latestShort := m.status.LatestShort
	checkedAt := m.status.CheckedAt
	m.status = buildBaseUpdateStatus()
	m.status.State = state
	m.status.Message = message
	m.status.LatestVersion = latestVersion
	m.status.LatestRevision = latestRevision
	m.status.LatestShort = latestShort
	m.status.CheckedAt = checkedAt
	m.status.UpdateAvailable = isVersionNewer(m.status.CurrentVersion, latestVersion)
}

func (m *updateManager) finishError(message string, err error) {
	m.markError(message, err)
	m.mu.Lock()
	m.busy = false
	m.mu.Unlock()
}

func (m *updateManager) finishSuccess(state, message string, latestVersion string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	latestRevision := m.status.LatestRevision
	latestShort := m.status.LatestShort
	checkedAt := m.status.CheckedAt
	m.status = buildBaseUpdateStatus()
	m.status.State = state
	m.status.Message = message
	m.status.LatestVersion = strings.TrimSpace(latestVersion)
	m.status.LatestRevision = latestRevision
	m.status.LatestShort = latestShort
	m.status.CheckedAt = checkedAt
	m.status.UpdateAvailable = false
	m.busy = false
}

func buildBaseUpdateStatus() updateStatus {
	exe, _ := os.Executable()
	if exe != "" {
		exe = filepath.Clean(exe)
	}
	meta := readInstallMetadata(exe)
	currentRev, currentModified := currentRevisionInfo()
	repoURL := strings.TrimSpace(os.Getenv("BIGLOG_UPDATE_REPO"))
	if repoURL == "" {
		repoURL = strings.TrimSpace(meta.RepoURL)
	}
	if repoURL == "" {
		repoURL = defaultUpdateRepo
	}
	st := updateStatus{
		RepoURL:         repoURL,
		Executable:      exe,
		GOOS:            runtime.GOOS,
		CurrentVersion:  currentVersion(),
		CurrentRevision: currentRev,
		CurrentShort:    shortHash(currentRev),
		CurrentModified: currentModified,
		InstallScript:   meta.InstallScript,
		InstalledAt:     meta.InstalledAt,
	}
	st.CanCheck = repoURL != "" && commandAvailable("git")
	st.CanApply, st.UnsupportedReason = canSelfUpdate(exe, repoURL)
	return st
}

func currentRevisionInfo() (string, bool) {
	info, ok := debug.ReadBuildInfo()
	if !ok || info == nil {
		return "", false
	}
	var rev string
	var modified bool
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			rev = strings.TrimSpace(setting.Value)
		case "vcs.modified":
			modified = strings.EqualFold(strings.TrimSpace(setting.Value), "true")
		}
	}
	return rev, modified
}

func currentVersion() string {
	v := normalizeVersion(appVersion)
	if v != "" && !strings.EqualFold(v, "dev") {
		return v
	}
	if cwd, err := os.Getwd(); err == nil {
		if version, err := readVersionFromPackageJSON(filepath.Join(cwd, "package.json")); err == nil && version != "" {
			return version
		}
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(filepath.Clean(exe))
		if version, err := readVersionFromPackageJSON(filepath.Join(dir, "package.json")); err == nil && version != "" {
			return version
		}
	}
	if strings.EqualFold(strings.TrimSpace(appVersion), "dev") {
		return ""
	}
	return normalizeVersion(appVersion)
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(strings.ToLower(v), "v")
	return v
}

func parseVersion(v string) ([]int, bool) {
	v = normalizeVersion(v)
	if v == "" {
		return nil, false
	}
	parts := strings.Split(v, ".")
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			out = append(out, 0)
			continue
		}
		for i, r := range part {
			if r < '0' || r > '9' {
				if i == 0 {
					return nil, false
				}
				part = part[:i]
				break
			}
		}
		value, err := strconv.Atoi(part)
		if err != nil {
			return nil, false
		}
		out = append(out, value)
	}
	for len(out) > 0 && out[len(out)-1] == 0 {
		out = out[:len(out)-1]
	}
	if len(out) == 0 {
		return []int{0}, true
	}
	return out, true
}

func versionCompare(current, latest string) int {
	current = normalizeVersion(current)
	latest = normalizeVersion(latest)
	if current == latest {
		return 0
	}
	currentParts, currentOK := parseVersion(current)
	latestParts, latestOK := parseVersion(latest)
	if currentOK && latestOK {
		maxLen := len(currentParts)
		if len(latestParts) > maxLen {
			maxLen = len(latestParts)
		}
		for i := 0; i < maxLen; i++ {
			cv := 0
			lv := 0
			if i < len(currentParts) {
				cv = currentParts[i]
			}
			if i < len(latestParts) {
				lv = latestParts[i]
			}
			if cv < lv {
				return -1
			}
			if cv > lv {
				return 1
			}
		}
		return 0
	}
	if current == "" && latest != "" {
		return -1
	}
	if current != "" && latest == "" {
		return 1
	}
	if current < latest {
		return -1
	}
	if current > latest {
		return 1
	}
	return 0
}

func isVersionNewer(current, latest string) bool {
	return versionCompare(current, latest) < 0
}

func shortHash(rev string) string {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		return ""
	}
	if len(rev) > 8 {
		return rev[:8]
	}
	return rev
}

func installMetaPath(exe string) string {
	if exe == "" {
		return ""
	}
	dir := filepath.Dir(exe)
	base := strings.TrimSuffix(filepath.Base(exe), filepath.Ext(exe))
	if base == "" {
		base = "biglog"
	}
	return filepath.Join(dir, base+"-install.json")
}

func readInstallMetadata(exe string) installMetadata {
	metaPath := installMetaPath(exe)
	if metaPath == "" {
		return installMetadata{}
	}
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return installMetadata{}
	}
	var meta installMetadata
	if json.Unmarshal(data, &meta) != nil {
		return installMetadata{}
	}
	return meta
}

func commandAvailable(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func canSelfUpdate(exe, repoURL string) (bool, string) {
	if strings.TrimSpace(repoURL) == "" {
		return false, "No update source is configured for this build."
	}
	if !commandAvailable("git") {
		return false, "Git was not found on PATH."
	}
	if !commandAvailable("go") {
		return false, "Go was not found on PATH."
	}
	if exe == "" {
		return false, "The running executable path could not be determined."
	}
	cleaned := filepath.Clean(exe)
	lower := strings.ToLower(cleaned)
	tempDir := strings.ToLower(os.TempDir())
	if strings.Contains(lower, string(os.PathSeparator)+"go-build") || strings.Contains(lower, string(os.PathSeparator)+"__debug_bin") {
		return false, "Self-update only works from the installed desktop binary, not from go run or a debugger temp build."
	}
	if strings.HasPrefix(lower, tempDir+string(os.PathSeparator)) && !strings.EqualFold(filepath.Base(cleaned), "biglog") && !strings.EqualFold(filepath.Base(cleaned), "biglog.exe") {
		return false, "Self-update only works from the installed desktop binary, not from a temp build."
	}
	return true, ""
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return strings.TrimSpace(err.Error())
}

func trimCmdOutput(out []byte) string {
	cleaned := strings.TrimSpace(string(out))
	if cleaned == "" {
		return ""
	}
	lines := strings.Split(cleaned, "\n")
	if len(lines) > 12 {
		lines = lines[len(lines)-12:]
	}
	joined := strings.Join(lines, "\n")
	if len(joined) > 2000 {
		joined = joined[len(joined)-2000:]
	}
	return strings.TrimSpace(joined)
}

func wrapCmdError(prefix string, err error, out []byte) error {
	if err == nil {
		return nil
	}
	trimmed := trimCmdOutput(out)
	if trimmed == "" {
		return fmt.Errorf("%s: %w", prefix, err)
	}
	return fmt.Errorf("%s: %w\n%s", prefix, err, trimmed)
}

func readVersionFromPackageJSON(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var payload struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return "", err
	}
	return normalizeVersion(payload.Version), nil
}

func repoHeadRevision(repoDir string) string {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, gitPath, "-C", repoDir, "rev-parse", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func latestRemoteBuildInfo(ctx context.Context, repoURL string) (remoteBuildInfo, error) {
	tmpDir, err := os.MkdirTemp("", "biglog-check-*")
	if err != nil {
		return remoteBuildInfo{}, err
	}
	defer os.RemoveAll(tmpDir)
	repoDir := filepath.Join(tmpDir, "repo")
	if err := cloneLatestRepo(ctx, repoURL, repoDir); err != nil {
		return remoteBuildInfo{}, err
	}
	version, err := readVersionFromPackageJSON(filepath.Join(repoDir, "package.json"))
	if err != nil {
		return remoteBuildInfo{}, fmt.Errorf("failed to read the remote package version: %w", err)
	}
	return remoteBuildInfo{
		Version:  version,
		Revision: repoHeadRevision(repoDir),
	}, nil
}

func updateStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, updater.snapshot())
}

func updateCheckHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "GET or POST only", http.StatusMethodNotAllowed)
		return
	}
	base := updater.reset("checking", "Checking for updates...")
	if !base.CanCheck {
		reason := base.UnsupportedReason
		if strings.TrimSpace(reason) == "" {
			reason = "Git was not found on PATH."
		}
		writeJSON(w, updater.markError("Unable to check for updates.", errors.New(reason)))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	info, err := latestRemoteBuildInfo(ctx, base.RepoURL)
	if err != nil {
		writeJSON(w, updater.markError("Failed to check for updates.", err))
		return
	}
	writeJSON(w, updater.updateLatest(info))
}

func updateApplyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	base := updater.snapshot()
	if !base.CanApply {
		http.Error(w, base.UnsupportedReason, http.StatusBadRequest)
		return
	}
	if !updater.beginInstall() {
		http.Error(w, "an update is already in progress", http.StatusConflict)
		return
	}
	go performSelfUpdate(base)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(updater.snapshot())
}

func performSelfUpdate(base updateStatus) {
	repoURL := base.RepoURL
	exe := base.Executable
	updater.setProgress("cloning", "Downloading the latest source...")

	tmpDir, err := os.MkdirTemp("", "biglog-update-*")
	if err != nil {
		updater.finishError("Failed to prepare the update workspace.", err)
		return
	}

	repoDir := filepath.Join(tmpDir, "repo")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	if err := cloneLatestRepo(ctx, repoURL, repoDir); err != nil {
		cancel()
		updater.finishError("Failed to download the latest build.", err)
		return
	}
	cancel()

	remoteVersion, err := readVersionFromPackageJSON(filepath.Join(repoDir, "package.json"))
	if err != nil {
		updater.finishError("Failed to read the remote version.", err)
		return
	}
	if !isVersionNewer(base.CurrentVersion, remoteVersion) {
		updater.finishError("No update is available.", fmt.Errorf("current version %s is already up to date with remote version %s", emptyVersionLabel(base.CurrentVersion), emptyVersionLabel(remoteVersion)))
		return
	}

	updater.setProgress("building", fmt.Sprintf("Building version %s...", remoteVersion))
	newExe := filepath.Join(tmpDir, filepath.Base(exe))
	if err := buildUpdatedBinary(repoDir, newExe); err != nil {
		updater.finishError("Failed to build the updated binary.", err)
		return
	}

	if runtime.GOOS == "windows" {
		updater.setProgress("restarting", fmt.Sprintf("Installing version %s and restarting Big Log...", remoteVersion))
	} else {
		updater.setProgress("closing", fmt.Sprintf("Installing version %s. Big Log will close. Restart it after the terminal message appears.", remoteVersion))
	}
	if err := launchReplacementHelper(exe, newExe, remoteVersion); err != nil {
		updater.finishError("Failed to apply the updated build.", err)
		return
	}

	if runtime.GOOS == "windows" {
		updater.finishSuccess("restarting", fmt.Sprintf("Installing version %s and restarting Big Log...", remoteVersion), remoteVersion)
	} else {
		updater.finishSuccess("updated", fmt.Sprintf("Version %s is ready. Restart Big Log after the terminal message appears.", remoteVersion), remoteVersion)
	}
	go func() {
		time.Sleep(900 * time.Millisecond)
		os.Exit(0)
	}()
}

func emptyVersionLabel(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return "(unknown)"
	}
	return v
}

func cloneLatestRepo(ctx context.Context, repoURL, repoDir string) error {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return errors.New("git was not found on PATH")
	}
	cmd := exec.CommandContext(ctx, gitPath, "clone", "--depth", "1", repoURL, repoDir)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return wrapCmdError("git clone failed", err, out.Bytes())
	}
	return nil
}

func buildUpdatedBinary(repoDir, outputPath string) error {
	goPath, err := exec.LookPath("go")
	if err != nil {
		return errors.New("go was not found on PATH")
	}
	version, err := readVersionFromPackageJSON(filepath.Join(repoDir, "package.json"))
	if err != nil {
		return fmt.Errorf("failed to read package.json version: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, goPath,
		"build",
		"-ldflags", fmt.Sprintf("-X main.appVersion=%s", version),
		"-o", outputPath,
		"./cmd/biglog",
	)
	cmd.Dir = repoDir
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return wrapCmdError("go build failed", err, out.Bytes())
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(outputPath, 0o755); err != nil {
			return err
		}
	}
	return nil
}

func launchReplacementHelper(currentExe, newExe, version string) error {
	if runtime.GOOS == "windows" {
		return launchWindowsUpdater(currentExe, newExe)
	}
	return launchUnixUpdater(currentExe, newExe, version)
}

func launchUnixUpdater(currentExe, newExe, version string) error {
	scriptPath := filepath.Join(filepath.Dir(newExe), "apply-update.sh")
	script := `#!/usr/bin/env bash
set -euo pipefail
PID_TO_WAIT="$1"
CURRENT_EXE="$2"
NEW_EXE="$3"
TARGET_VERSION="$4"
while kill -0 "$PID_TO_WAIT" 2>/dev/null; do
  sleep 0.2
done
chmod +x "$NEW_EXE"
mv -f "$NEW_EXE" "$CURRENT_EXE"
printf '\nBig Log updated to version %s. Restart the app manually.\n' "$TARGET_VERSION"
rm -f "$0"
`
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		return err
	}
	cmd := exec.Command("bash", scriptPath, fmt.Sprint(os.Getpid()), currentExe, newExe, version)
	if err := cmd.Start(); err != nil {
		return err
	}
	return nil
}

func launchWindowsUpdater(currentExe, newExe string) error {
	scriptPath := filepath.Join(filepath.Dir(newExe), "apply-update.ps1")
	script := `param(
  [Parameter(Mandatory=$true)][int]$PidToWait,
  [Parameter(Mandatory=$true)][string]$CurrentExe,
  [Parameter(Mandatory=$true)][string]$NewExe
)
$ErrorActionPreference = "Stop"
while (Get-Process -Id $PidToWait -ErrorAction SilentlyContinue) {
  Start-Sleep -Milliseconds 200
}
if (Test-Path -LiteralPath $CurrentExe) {
  Remove-Item -LiteralPath $CurrentExe -Force
}
Move-Item -LiteralPath $NewExe -Destination $CurrentExe -Force
Start-Process -FilePath $CurrentExe -WorkingDirectory (Split-Path -Parent $CurrentExe)
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`
	if err := os.WriteFile(scriptPath, []byte(script), 0o600); err != nil {
		return err
	}
	ps, err := exec.LookPath("powershell")
	if err != nil {
		ps, err = exec.LookPath("powershell.exe")
		if err != nil {
			return errors.New("powershell was not found on PATH")
		}
	}
	cmd := exec.Command(ps,
		"-NoProfile",
		"-ExecutionPolicy", "Bypass",
		"-WindowStyle", "Hidden",
		"-File", scriptPath,
		"-PidToWait", fmt.Sprint(os.Getpid()),
		"-CurrentExe", currentExe,
		"-NewExe", newExe,
	)
	if err := cmd.Start(); err != nil {
		return err
	}
	return nil
}
