#!/bin/bash
# Install (or refresh) the com.freshcontext.studio launchd agent for THIS
# checkout (:3440 — the brand image Studio; what the fresh-context-studio
# MCP talks to). Portable: stamps this checkout's absolute path into the
# plist template, so it works regardless of where the repo is cloned.
# Run once per machine:
#     bash install-launchd.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
LA="$HOME/Library/LaunchAgents"
DOM="gui/$(id -u)"
LABEL="com.freshcontext.studio"
mkdir -p "$LA" "$REPO/logs"

echo "Repo:   $REPO"
echo "Domain: $DOM"
echo

# If something is already holding :3440 that is NOT a managed launchd job
# (e.g. a manual `npm run dev`), free it so the managed agent can bind.
PORT_HOLDER="$(lsof -nP -iTCP:3440 -sTCP:LISTEN -t 2>/dev/null || true)"
if [ -n "$PORT_HOLDER" ]; then
  echo "Freeing :3440 (held by pid $PORT_HOLDER) so the managed agent can bind..."
  kill "$PORT_HOLDER" 2>/dev/null || true
fi

dest="$LA/$LABEL.plist"
sed "s|__REPO__|$REPO|g" "$REPO/$LABEL.plist" > "$dest"
plutil -lint "$dest" >/dev/null
launchctl bootout "$DOM/$LABEL" 2>/dev/null || true
# bootout doesn't always release the domain slot instantaneously; bootstrap
# can fail with a transient "Input/output error" right after. Retry briefly.
tries=0
until launchctl bootstrap "$DOM" "$dest" 2>/dev/null; do
  tries=$((tries + 1))
  [ "$tries" -ge 5 ] && { echo "FAILED to bootstrap $LABEL after $tries tries" >&2; exit 1; }
  sleep 1
done
launchctl kickstart -k "$DOM/$LABEL"
echo "installed + started: $LABEL"

echo
echo "Health (may take a few seconds to warm up):"
curl -s --retry 8 --retry-delay 1 --retry-connrefused -o /dev/null \
  -w "  studio :3440  -> %{http_code}\n" http://localhost:3440/healthz || echo "  studio :3440  -> (not up yet)"
echo
echo "Done. The fresh-context-studio MCP will now reach :3440 across sessions."
