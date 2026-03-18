#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/tm-LBenson/big-log-viewer.git"
DEST="$HOME/Desktop/biglog"
TMPDIR="$(mktemp -d)"
GO_VERSION_REQUIRED="1.22"

command -v git >/dev/null 2>&1 || {
  echo "git required"
  exit 1
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

PACKAGE_VERSION="$(python3 - <<'PY'
import json
with open('package.json', 'r', encoding='utf-8') as fh:
    print(json.load(fh).get('version', '').strip())
PY
)"

if [[ -z "$PACKAGE_VERSION" ]]; then
  echo "Could not read version from package.json"
  exit 1
fi

GOOS=darwin GOARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/') \
  CGO_ENABLED=0 \
  go build -ldflags "-X main.appVersion=$PACKAGE_VERSION" -o biglog ./cmd/biglog

mv biglog "$DEST"
META_PATH="$(dirname "$DEST")/$(basename "$DEST")-install.json"
cat > "$META_PATH" <<JSON
{"repoUrl":"$REPO","installScript":"mac-m1-m2/install_biglog.sh","installedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
JSON

echo "Built and placed $DEST"
echo "Version: $PACKAGE_VERSION"
