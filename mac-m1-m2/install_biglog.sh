#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/tm-LBenson/big-log-viewer.git"
DEST="$HOME/Desktop/biglog"
TMPDIR="$(mktemp -d)"
GO_VERSION_REQUIRED="1.22"

command -v git >/dev/null 2>&1 || {
  echo "git required"; exit 1;
}

if ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv || /usr/local/bin/brew shellenv)"
fi

if ! command -v go >/dev/null 2>&1 || [[ "$(go version | awk '{print $3}' | cut -c3-)" < "$GO_VERSION_REQUIRED" ]]; then
  brew install go
fi

git clone --depth 1 "$REPO" "$TMPDIR/app"
cd "$TMPDIR/app"

GOOS=darwin GOARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/') \
  CGO_ENABLED=0 \
  go build -o biglog ./cmd/biglog

mv biglog "$DEST"
echo "✔ Built and placed $DEST"

