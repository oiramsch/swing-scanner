#!/usr/bin/env bash
# update.sh — Pull latest code from GitHub and redeploy containers.
# Safe: .env and data/swing_scanner.db are gitignored and never touched by git.
#
# Usage:
#   ./update.sh           # normal update (uses Docker layer cache)
#   ./update.sh --clean   # force full rebuild (no cache)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[update]${NC} $*"; }
warn()    { echo -e "${YELLOW}[update]${NC} $*"; }
abort()   { echo -e "${RED}[update] ERROR:${NC} $*" >&2; exit 1; }

# ── Args ─────────────────────────────────────────────────────────────────────
NO_CACHE=""
for arg in "$@"; do
  [[ "$arg" == "--clean" ]] && NO_CACHE="--no-cache"
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────
[[ -f ".env" ]] || abort ".env not found — copy .env.example and fill in your keys first."
command -v docker >/dev/null 2>&1 || abort "docker not found in PATH."

# ── Ensure data dir exists (DB lives here) ────────────────────────────────────
mkdir -p data
info "data/ directory: OK"

# ── Git pull ──────────────────────────────────────────────────────────────────
info "Pulling latest code from GitHub…"
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "@{u}" 2>/dev/null || echo "")

if [[ -n "$REMOTE" && "$LOCAL" == "$REMOTE" ]]; then
  warn "Already up to date ($(git rev-parse --short HEAD)). Redeploying anyway."
else
  git pull --ff-only || abort "git pull failed — resolve conflicts manually."
  info "Updated to $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"
fi

# ── Build ─────────────────────────────────────────────────────────────────────
if [[ -n "$NO_CACHE" ]]; then
  info "Building images (no cache)…"
else
  info "Building images (with cache — use --clean to force full rebuild)…"
fi
docker compose build $NO_CACHE

# ── Deploy ────────────────────────────────────────────────────────────────────
info "Restarting containers…"
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
  [[ $i -eq $RETRIES ]] && warn "Backend health check timed out — check logs with: docker compose logs -f backend"
  sleep 5
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
info "Deploy complete."
echo -e "  Commit : $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
echo -e "  App    : http://$(hostname -I | awk '{print $1}'):8888/"
echo ""
docker compose ps
