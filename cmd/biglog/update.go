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
	"strings"
	"sync"
	"time"
)

const defaultUpdateRepo = "https://github.com/tm-LBenson/big-log-viewer.git"

var updater = newUpdateManager()

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
	latest := m.status.LatestRevision
	latestShort := m.status.LatestShort
	checkedAt := m.status.CheckedAt
	m.status = buildBaseUpdateStatus()
	m.status.State = state
	m.status.Message = message
	m.status.LatestRevision = latest
	m.status.LatestShort = latestShort
	m.status.CheckedAt = checkedAt
	if m.status.CurrentRevision != "" && latest != "" {
		m.status.UpdateAvailable = latest != m.status.CurrentRevision || m.status.CurrentModified
	} else if latest != "" {
		m.status.UpdateAvailable = true
	}
	return m.status
}

func (m *updateManager) updateLatest(rev string) updateStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.status = buildBaseUpdateStatus()
	m.status.State = "checked"
	m.status.LatestRevision = rev
	m.status.LatestShort = shortHash(rev)
	m.status.CheckedAt = time.Now().Format(time.RFC3339)
	if rev == "" {
		m.status.Message = "Could not determine the latest remote build."
		return m.status
	}
	switch {
	case m.status.CurrentRevision == "":
		m.status.UpdateAvailable = true
		m.status.Message = "Current build does not expose a revision. You can still install the latest remote build."
	case m.status.CurrentRevision == rev && !m.status.CurrentModified:
		m.status.UpdateAvailable = false
		m.status.Message = "You are already on the latest build."
	case m.status.CurrentRevision == rev && m.status.CurrentModified:
		m.status.UpdateAvailable = true
		m.status.Message = "Your build matches the latest commit but was built from modified source."
	default:
		m.status.UpdateAvailable = true
		m.status.Message = fmt.Sprintf("Update available: %s → %s", shortHash(m.status.CurrentRevision), shortHash(rev))
	}
	return m.status
}

func (m *updateManager) markError(message string, err error) updateStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	latest := m.status.LatestRevision
	latestShort := m.status.LatestShort
	checkedAt := m.status.CheckedAt
	m.status = buildBaseUpdateStatus()
	m.status.State = "error"
	m.status.Message = message
	m.status.Error = strings.TrimSpace(errString(err))
	m.status.LatestRevision = latest
	m.status.LatestShort = latestShort
	m.status.CheckedAt = checkedAt
	if m.status.CurrentRevision != "" && latest != "" {
		m.status.UpdateAvailable = latest != m.status.CurrentRevision || m.status.CurrentModified
	} else if latest != "" {
		m.status.UpdateAvailable = true
	}
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
	m.status.Message = "Preparing the update…"
	return true
}

func (m *updateManager) setProgress(state, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	latest := m.status.LatestRevision
	latestShort := m.status.LatestShort
	checkedAt := m.status.CheckedAt
	m.status = buildBaseUpdateStatus()
	m.status.State = state
	m.status.Message = message
	m.status.LatestRevision = latest
	m.status.LatestShort = latestShort
	m.status.CheckedAt = checkedAt
	if latest != "" && m.status.CurrentRevision != "" {
		m.status.UpdateAvailable = latest != m.status.CurrentRevision || m.status.CurrentModified
	} else if latest != "" {
		m.status.UpdateAvailable = true
	}
}

func (m *updateManager) finishError(message string, err error) {
	m.markError(message, err)
	m.mu.Lock()
	m.busy = false
	m.mu.Unlock()
}

func (m *updateManager) finishSuccess(message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	latest := m.status.LatestRevision
	latestShort := m.status.LatestShort
	checkedAt := m.status.CheckedAt
	m.status = buildBaseUpdateStatus()
	m.status.State = "restarting"
	m.status.Message = message
	m.status.LatestRevision = latest
	m.status.LatestShort = latestShort
	m.status.CheckedAt = checkedAt
	m.status.UpdateAvailable = false
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

func latestRemoteRevision(ctx context.Context, repoURL string) (string, error) {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return "", errors.New("git was not found on PATH")
	}
	cmd := exec.CommandContext(ctx, gitPath, "ls-remote", "--quiet", repoURL, "HEAD")
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return "", wrapCmdError("failed to query the remote repository", err, out.Bytes())
	}
	fields := strings.Fields(out.String())
	if len(fields) == 0 {
		return "", errors.New("remote repository did not return a revision")
	}
	return strings.TrimSpace(fields[0]), nil
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
	base := updater.reset("checking", "Checking for updates…")
	if !base.CanCheck {
		reason := base.UnsupportedReason
		if strings.TrimSpace(reason) == "" {
			reason = "Git was not found on PATH."
		}
		writeJSON(w, updater.markError("Unable to check for updates.", errors.New(reason)))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	rev, err := latestRemoteRevision(ctx, base.RepoURL)
	if err != nil {
		writeJSON(w, updater.markError("Failed to check for updates.", err))
		return
	}
	writeJSON(w, updater.updateLatest(rev))
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
	workDir, _ := os.Getwd()
	if workDir == "" {
		workDir = filepath.Dir(exe)
	}
	updater.setProgress("cloning", "Downloading the latest source…")

	tmpDir, err := os.MkdirTemp("", "biglog-update-*")
	if err != nil {
		updater.finishError("Failed to prepare the update workspace.", err)
		return
	}

	repoDir := filepath.Join(tmpDir, "repo")
	if err := cloneLatestRepo(repoURL, repoDir); err != nil {
		updater.finishError("Failed to download the latest build.", err)
		return
	}

	updater.setProgress("building", "Building the updated binary…")
	newExe := filepath.Join(tmpDir, filepath.Base(exe))
	if err := buildUpdatedBinary(repoDir, newExe); err != nil {
		updater.finishError("Failed to build the updated binary.", err)
		return
	}

	updater.setProgress("restarting", "Restarting Big Log with the updated build…")
	if err := launchReplacementHelper(exe, newExe, workDir); err != nil {
		updater.finishError("Failed to restart into the updated build.", err)
		return
	}

	updater.finishSuccess("Restarting Big Log with the updated build…")
	go func() {
		time.Sleep(800 * time.Millisecond)
		os.Exit(0)
	}()
}

func cloneLatestRepo(repoURL, repoDir string) error {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		return errors.New("git was not found on PATH")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
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
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, goPath, "build", "-o", outputPath, "./cmd/biglog")
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

func launchReplacementHelper(currentExe, newExe, workingDir string) error {
	tempDir := filepath.Dir(newExe)
	argsFile, err := writeArgsFile(tempDir, os.Args[1:])
	if err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		return launchWindowsUpdater(currentExe, newExe, argsFile, workingDir)
	}
	return launchUnixUpdater(currentExe, newExe, argsFile, workingDir)
}

func writeArgsFile(dir string, args []string) (string, error) {
	path := filepath.Join(dir, "biglog-args.txt")
	if err := os.WriteFile(path, []byte(strings.Join(args, "\n")), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

func launchUnixUpdater(currentExe, newExe, argsFile, workingDir string) error {
	scriptPath := filepath.Join(filepath.Dir(newExe), "apply-update.sh")
	script := `#!/usr/bin/env bash
set -euo pipefail
PID_TO_WAIT="$1"
CURRENT_EXE="$2"
NEW_EXE="$3"
ARGS_FILE="$4"
WORKING_DIR="$5"
while kill -0 "$PID_TO_WAIT" 2>/dev/null; do
  sleep 0.2
done
chmod +x "$NEW_EXE"
mv -f "$NEW_EXE" "$CURRENT_EXE"
ARGS=()
if [[ -f "$ARGS_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    ARGS+=("$line")
  done < "$ARGS_FILE"
fi
if [[ -d "$WORKING_DIR" ]]; then
  cd "$WORKING_DIR" || true
fi
nohup "$CURRENT_EXE" "${ARGS[@]}" >/dev/null 2>&1 &
rm -f "$ARGS_FILE" "$0"
`
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		return err
	}
	cmd := exec.Command("bash", scriptPath, fmt.Sprint(os.Getpid()), currentExe, newExe, argsFile, workingDir)
	if err := cmd.Start(); err != nil {
		return err
	}
	return nil
}

func launchWindowsUpdater(currentExe, newExe, argsFile, workingDir string) error {
	scriptPath := filepath.Join(filepath.Dir(newExe), "apply-update.ps1")
	script := `param(
  [Parameter(Mandatory=$true)][int]$PidToWait,
  [Parameter(Mandatory=$true)][string]$CurrentExe,
  [Parameter(Mandatory=$true)][string]$NewExe,
  [Parameter(Mandatory=$true)][string]$ArgsFile,
  [Parameter(Mandatory=$true)][string]$WorkingDir
)
$ErrorActionPreference = "Stop"
while (Get-Process -Id $PidToWait -ErrorAction SilentlyContinue) {
  Start-Sleep -Milliseconds 200
}
if (Test-Path -LiteralPath $CurrentExe) {
  Remove-Item -LiteralPath $CurrentExe -Force
}
Move-Item -LiteralPath $NewExe -Destination $CurrentExe -Force
$argsList = @()
if (Test-Path -LiteralPath $ArgsFile) {
  $argsList = Get-Content -LiteralPath $ArgsFile
}
Start-Process -FilePath $CurrentExe -WorkingDirectory $WorkingDir -ArgumentList $argsList
Remove-Item -LiteralPath $ArgsFile -Force -ErrorAction SilentlyContinue
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
		"-ArgsFile", argsFile,
		"-WorkingDir", workingDir,
	)
	if err := cmd.Start(); err != nil {
		return err
	}
	return nil
}
