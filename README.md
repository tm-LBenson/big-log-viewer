# Big-Log Viewer

A desktop utility designed for efficiently viewing **multi-gigabyte HTML log files** without running out of memory. Logs are loaded in pages on-demand, ensuring instant scrolling even for extremely large files.

---

## Quick Start

---

### Pre-requisites

Before running the install script, ensure you have the following software installed on your machine:

- **[Git](https://git-scm.com/downloads)**
- **[Go](https://golang.org/dl/)**
- **[Homebrew](https://brew.sh/)** (for macOS users)

### macOS

1. Download the `install_biglog.sh` script from the **[GitHub repository](https://github.com/tm-LBenson/big-log-viewer/blob/main/mac-m1-m2/install_biglog.sh)**, or copy the script into a new file.
2. Make the script executable and run it:

```bash
chmod +x install_biglog.sh
./install_biglog.sh
```

The script will:

1. Install **Homebrew**, **git**, and **Go** if not already installed.
2. Clone the repository to a temporary folder.
3. Build the universal binary.
4. Place the **biglog** binary on your Desktop.

### Windows

1. Download the `install_biglog.ps1` script from the **[GitHub repository](https://github.com/tm-LBenson/big-log-viewer/blob/main/windows/install_biglog.ps1)**, or copy the script into a new file.
2. Open **PowerShell as Administrator** and run the following commands:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install_biglog.ps1
```

The script will:

1. Install **Git** and **Go** via winget if not already installed.
2. Clone the repository to the `%TEMP%` directory.
3. Build the `biglog.exe` binary.
4. Move the built binary to your Desktop.

---

## Running the Application

1. Double-click to launch the **biglog** application.
2. Open your browser and go to [http://localhost:8844](http://localhost:8844) to access the log viewer UI.

---

### Features

- **Infinite Scrolling**: Memory-safe paging for large files, ensuring smooth and instant scrolling.
- **Search**: Fast, real-time searching with jump-to-match functionality.
- **Toggle Views**: Switch between raw log text and rendered HTML.
- **Cross-Platform Support**: Precompiled binaries for both **macOS** (ARM/Intel) and **Windows**.

---

### Configuration

- By default, **Big-Log Viewer** looks for a `logs` folder in the same directory as the executable.
- The location of this folder can be customized, allowing flexibility in where your log files are stored.

---

### Closing the Application

Once running, **Big-Log Viewer** operates via a command-line interface. To exit, simply press **Ctrl+C** to stop the process.

---

### Building the Application Manually

If you prefer to build the application yourself:

```bash
git clone https://github.com/tm-LBenson/big-log-viewer.git
cd big-log-viewer
go build -o biglog ./cmd/biglog
```

_Frontend assets are embedded in the binary; no additional files are required._
