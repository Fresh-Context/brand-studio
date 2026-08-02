#!/bin/bash
# Install (or refresh) the Fresh Context launchd agents for THIS checkout:
#   • com.freshcontext.logger  (:3430  — sessions/vault/notes companion)
#   • com.freshcontext.studio  (:3440  — brand image Studio; what the
#                                        fresh-context-studio MCP talks to)
# Portable: stamps this checkout's absolute path into the plist templates, so it
# works regardless of where the repo is cloned. Run once per machine:
#     bash apps/studio/install-launchd.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"     # apps/studio/../../ = repo root
LA="$HOME/Library/LaunchAgents"
DOM="gui/$(id -u)"
mkdir -p "$LA" "$REPO/local-server/logs" "$REPO/apps/studio/logs"

echo "Repo:   $REPO"
echo "Domain: $DOM"
echo

# If something is already holding :3440 that is NOT a managed launchd job
# (e.g. a manual `npm start`), free it so the managed agent can bind.
PORT_HOLDER="$(lsof -nP -iTCP:3440 -sTCP:LISTEN -t 2>/dev/null || true)"
if [ -n "$PORT_HOLDER" ]; then
  echo "Freeing :3440 (held by pid $PORT_HOLDER) so the managed agent can bind..."
  kill "$PORT_HOLDER" 2>/dev/null || true
fi

# better-sqlite3 ships a prebuilt native addon; if it was built (or npm-installed)
# under a different Node than launchd's PATH resolves (/opt/homebrew/bin first —
# see plist EnvironmentVariables), the logger crash-loops with ERR_DLOPEN_FAILED
# / NODE_MODULE_VERSION mismatch. Rebuild against that exact node up front so a
# fresh checkout doesn't silently fail into "Waiting for file changes..." forever.
LOGGER_NODE="$(command -v node)"
[ -x /opt/homebrew/bin/node ] && LOGGER_NODE=/opt/homebrew/bin/node
echo "Rebuilding native deps for $($LOGGER_NODE -v)..."
( cd "$REPO/local-server" && rm -rf node_modules/better-sqlite3/build && \
  PATH="$(dirname "$LOGGER_NODE"):$PATH" npm rebuild better-sqlite3 >/dev/null )
echo

install_one() {
  local label="$1" template="$2"
  local dest="$LA/$label.plist"
  sed "s|__REPO__|$REPO|g" "$template" > "$dest"
  plutil -lint "$dest" >/dev/null
  launchctl bootout "$DOM/$label" 2>/dev/null || true
  # bootout doesn't always release the domain slot instantaneously; bootstrap
  # can fail with a transient "Input/output error" right after. Retry briefly.
  local tries=0
  until launchctl bootstrap "$DOM" "$dest" 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -ge 5 ] && { echo "  FAILED to bootstrap $label after $tries tries" >&2; return 1; }
    sleep 1
  done
  launchctl kickstart -k "$DOM/$label"
  echo "  installed + started: $label"
}

install_one com.freshcontext.logger "$REPO/local-server/com.freshcontext.logger.plist"
install_one com.freshcontext.studio "$REPO/apps/studio/com.freshcontext.studio.plist"

echo
echo "Health (may take a few seconds to warm up):"
curl -s --retry 8 --retry-delay 1 --retry-connrefused -o /dev/null \
  -w "  logger :3430  -> %{http_code}\n" http://localhost:3430/ || echo "  logger :3430  -> (not up yet)"
curl -s --retry 8 --retry-delay 1 --retry-connrefused -o /dev/null \
  -w "  studio :3440  -> %{http_code}\n" http://localhost:3440/healthz || echo "  studio :3440  -> (not up yet)"
echo
echo "Done. The fresh-context-studio MCP will now reach :3440 across sessions."
