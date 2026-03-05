#!/bin/sh
# AgentRun Bridge — one-line installer
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/phbruce/agentrun/main/bridge/install.sh | sh
#
set -e

BINARY="agentrun-bridge"
REPO="phbruce/agentrun"
TAG_PREFIX="bridge-v"
INSTALL_DIR="${HOME}/.local/bin"

# --- Detect platform ---

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)        ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

ASSET="${BINARY}-${OS}-${ARCH}"

echo ""
echo "  AgentRun Bridge Installer"
echo "  ─────────────────────────"
echo "  OS:   ${OS}/${ARCH}"
echo ""

# --- Get latest release tag ---

VERSION=$(curl -sfL "https://api.github.com/repos/${REPO}/releases" \
  | grep -o "\"tag_name\": *\"${TAG_PREFIX}[^\"]*\"" | head -1 \
  | sed "s/.*\"${TAG_PREFIX}//" | sed 's/"//' 2>/dev/null || echo "")

if [ -z "$VERSION" ]; then
  echo "  No release found. Building from source..."

  if ! command -v go >/dev/null 2>&1; then
    echo ""
    echo "  Go not installed. Install with:"
    echo "    brew install go    (macOS)"
    echo "    apt install golang (Linux)"
    exit 1
  fi

  TMPDIR=$(mktemp -d)
  git clone --depth 1 "https://github.com/${REPO}.git" "$TMPDIR" 2>/dev/null
  mkdir -p "$INSTALL_DIR"
  (cd "$TMPDIR/bridge" && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "${INSTALL_DIR}/${BINARY}" .)
  rm -rf "$TMPDIR"
  chmod +x "${INSTALL_DIR}/${BINARY}"
  echo "  Built from source: ${INSTALL_DIR}/${BINARY}"
else
  TAG="${TAG_PREFIX}${VERSION}"
  echo "  Version: ${VERSION}"
  echo ""

  # --- Download binary + SHA256SUMS ---

  RELEASE_URL="https://github.com/${REPO}/releases/download/${TAG}"

  mkdir -p "$INSTALL_DIR"
  DEST="${INSTALL_DIR}/${BINARY}"
  TMPDIR=$(mktemp -d)

  echo "  Downloading ${ASSET}..."
  if ! curl -sfL -o "${TMPDIR}/${ASSET}" "${RELEASE_URL}/${ASSET}"; then
    echo "  ERROR: Failed to download binary"
    rm -rf "$TMPDIR"
    exit 1
  fi

  echo "  Verifying SHA256 checksum..."
  if ! curl -sfL -o "${TMPDIR}/SHA256SUMS" "${RELEASE_URL}/SHA256SUMS"; then
    echo "  WARNING: SHA256SUMS not found — skipping verification"
  else
    EXPECTED=$(grep "${ASSET}$" "${TMPDIR}/SHA256SUMS" | awk '{print $1}')
    if [ -z "$EXPECTED" ]; then
      echo "  ERROR: Checksum for ${ASSET} not found in SHA256SUMS"
      rm -rf "$TMPDIR"
      exit 1
    fi

    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL=$(sha256sum "${TMPDIR}/${ASSET}" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
      ACTUAL=$(shasum -a 256 "${TMPDIR}/${ASSET}" | awk '{print $1}')
    else
      echo "  WARNING: No sha256sum/shasum found — skipping verification"
      ACTUAL="$EXPECTED"
    fi

    if [ "$ACTUAL" != "$EXPECTED" ]; then
      echo "  ERROR: SHA256 mismatch!"
      echo "    Expected: ${EXPECTED}"
      echo "    Actual:   ${ACTUAL}"
      rm -rf "$TMPDIR"
      exit 1
    fi
    echo "  SHA256 OK"
  fi

  cp "${TMPDIR}/${ASSET}" "$DEST"
  chmod +x "$DEST"
  rm -rf "$TMPDIR"
  echo "  Installed: ${DEST}"
fi

# --- Ensure PATH ---

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  SHELL_RC=""
  case "$SHELL" in
    */zsh)  SHELL_RC="$HOME/.zshrc" ;;
    */bash) SHELL_RC="$HOME/.bashrc" ;;
  esac

  if [ -n "$SHELL_RC" ] && ! grep -q "$INSTALL_DIR" "$SHELL_RC" 2>/dev/null; then
    echo "" >> "$SHELL_RC"
    echo "# AgentRun Bridge" >> "$SHELL_RC"
    echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" >> "$SHELL_RC"
    echo "  PATH updated in: ${SHELL_RC}"
  fi

  export PATH="${INSTALL_DIR}:$PATH"
fi

# --- Authenticate ---

echo ""
echo "  Authenticating with GitHub..."
echo ""
"$DEST" login

echo ""
echo "  Done! AgentRun Bridge is configured."
echo ""
echo "  Commands:"
echo "    agentrun-bridge status    Check authentication"
echo "    agentrun-bridge login     Re-authenticate"
echo "    agentrun-bridge logout    Remove token"
echo ""
