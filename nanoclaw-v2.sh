#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PROJECT_ROOT
export NANOCLAW_PROJECT_ROOT="$PROJECT_ROOT"
source "$PROJECT_ROOT/setup/lib/install-slug.sh"

LABEL="$(launchd_label)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$PROJECT_ROOT/logs/nanoclaw.log"
ERR="$PROJECT_ROOT/logs/nanoclaw.error.log"

usage() {
  cat <<EOF
Usage: ./nanoclaw-v2.sh <command>

Commands:
  start     Install/update and start the per-checkout NanoClaw service
  stop      Stop the service
  restart   Reinstall/update and restart the service
  status    Show launchd status
  logs      Follow NanoClaw logs
EOF
}

case "${1:-}" in
  start|restart)
    cd "$PROJECT_ROOT"
    PATH="/Users/binxuwang/.nvm/versions/node/v22.17.1/bin:/Users/binxuwang/miniforge3/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH" \
      pnpm exec tsx setup/index.ts --step service
    ;;
  stop)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST"
    elif [ -f "$PLIST" ]; then
      launchctl unload "$PLIST" 2>/dev/null || true
    fi
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL"; then
      exit 0
    fi
    echo "NanoClaw service is not loaded: $LABEL"
    exit 1
    ;;
  logs)
    touch "$LOG" "$ERR"
    tail -f "$LOG" "$ERR"
    ;;
  *)
    usage
    exit 2
    ;;
esac
