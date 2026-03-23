#!/usr/bin/env bash
# update.sh — Download latest code from GitHub (no git required) and redeploy.
# Safe: .env and data/ are gitignored → never in the archive → never overwritten.
#
# Usage:
#   ./update.sh           # normal update (uses Docker layer cache)
#   ./update.sh --clean   # force full rebuild (no cache)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GITHUB_REPO="oiramsch/swing-scanner"
BRANCH="main"
ARCHIVE_URL="https://github.com/${GITHUB_REPO}/archive/refs/heads/${BRANCH}.tar.gz"
TMP_ARCHIVE="/tmp/swing-update.tar.gz"
TMP_DIR="/tmp/swing-update"

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[update]${NC} $*"; }
warn()  { echo -e "${YELLOW}[update]${NC} $*"; }
abort() { echo -e "${RED}[update] ERROR:${NC} $*" >&2; exit 1; }

# ── Args ─────────────────────────────────────────────────────────────────────
NO_CACHE=""
for arg in "$@"; do
  [[ "$arg" == "--clean" ]] && NO_CACHE="--no-cache"
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────
[[ -f ".env" ]] || abort ".env not found — copy .env.example and fill in your keys first."
command -v curl   >/dev/null 2>&1 || abort "curl not found in PATH."
command -v docker >/dev/null 2>&1 || abort "docker not found in PATH."

mkdir -p data
info "data/ directory: OK"

# ── Download from GitHub ──────────────────────────────────────────────────────
info "Downloading latest code from GitHub (${GITHUB_REPO}@${BRANCH})…"
curl -fsSL "$ARCHIVE_URL" -o "$TMP_ARCHIVE" \
  || abort "Download failed — check your internet connection."

# ── Extract ───────────────────────────────────────────────────────────────────
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
# GitHub archive root is "swing-scanner-main/" → strip it
tar -xzf "$TMP_ARCHIVE" -C "$TMP_DIR" --strip-components=1
info "Extracted to ${TMP_DIR}"

# ── Sync files (.env and data/ are gitignored → not in archive → safe) ────────
info "Syncing files…"
cp -r "$TMP_DIR"/. ./

# ── Cleanup temp files ────────────────────────────────────────────────────────
rm -rf "$TMP_ARCHIVE" "$TMP_DIR"

# ── Show latest commit info (optional — requires curl + python3) ──────────────
COMMIT_INFO=""
if command -v python3 >/dev/null 2>&1; then
  COMMIT_INFO=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/commits/${BRANCH}" 2>/dev/null \
    | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    sha = d['sha'][:7]
    msg = d['commit']['message'].split('\n')[0]
    print(f'{sha} — {msg}')
except: pass
" 2>/dev/null || echo "")
fi
[[ -n "$COMMIT_INFO" ]] && info "Version: ${COMMIT_INFO}"

# ── Stop running containers ───────────────────────────────────────────────────
info "Stopping running containers…"
docker compose down --timeout 15

# ── Build ─────────────────────────────────────────────────────────────────────
if [[ -n "$NO_CACHE" ]]; then
  info "Building images (no cache)…"
else
  info "Building images (with cache — use --clean to force full rebuild)…"
fi
docker compose build $NO_CACHE

# ── Deploy ────────────────────────────────────────────────────────────────────
info "Starting containers…"
docker compose up -d --remove-orphans

# ── Health check ─────────────────────────────────────────────────────────────
info "Waiting for backend to become healthy…"
RETRIES=12
for i in $(seq 1 $RETRIES); do
  STATUS=$(docker compose ps --format json backend 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health',''))" 2>/dev/null || echo "")
  if [[ "$STATUS" == "healthy" ]]; then
    info "Backend is healthy."
    break
  fi
  [[ $i -eq $RETRIES ]] && warn "Health check timed out — check: docker compose logs -f backend"
  sleep 5
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
info "Deploy complete."
[[ -n "$COMMIT_INFO" ]] && echo -e "  Version: ${COMMIT_INFO}"
echo -e "  App:     http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'NAS-IP'):8888/"
echo ""
docker compose ps
