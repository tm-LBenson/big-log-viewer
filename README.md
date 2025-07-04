# Big-Log Viewer

A desktop utility for viewing **multi-gigabyte HTML log files** without
running out of memory.
Logs are loaded in pages on-demand, so you can scroll instantly even on
very large files.

---

## Quick-start

### macOS

```bash
chmod +x setup-biglog.sh
./setup-biglog.sh
```

The script:

1. Installs **Homebrew**, **git**, and **Go** if missing.
2. Clones the repo to a temp folder.
3. Builds the universal binary.
4. Drops **biglog** on your Desktop.

### Windows

Open **PowerShell as Administrator**, then:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\setup-biglog.ps1
```

The script:

1. Installs Git and Go via winget if missing.
2. Clones the repo to %TEMP%.
3. Builds biglog.exe.
4. Moves it to your Desktop.

---

## Running the app

Double click to run the generated file.
Open a browser to [http://localhost:8844](http://localhost:8844) to use the UI.

---

### Features

- Infinite scrolling with page-cache (memory-safe on huge files)
- Folder picker, tree view, and fast search with jump-to-match
- Toggle between rendered HTML and raw text
- Cross-compiled binaries for macOS ARM/Intel and Windows

---

### Building manually

```bash
git clone https://github.com/tm-LBenson/big-log-viewer.git
cd big-log-viewer
go build -o biglog ./cmd/biglog
```

_Frontend assets are embedded in the binary; no extra files needed._
