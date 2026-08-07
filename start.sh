#!/bin/bash
# Fresh Context Studio — start script.
# Used by launchd (com.freshcontext.studio.plist) and for manual start.
# Runs the standalone brand-studio API on port 3440 (the companion app uses 3430).

cd "$(dirname "$0")"

# Find node — check common locations
if command -v node &>/dev/null; then
  NODE=$(command -v node)
elif [ -f /opt/homebrew/bin/node ]; then
  NODE=/opt/homebrew/bin/node
elif [ -f /usr/local/bin/node ]; then
  NODE=/usr/local/bin/node
else
  echo "ERROR: node not found" >&2
  exit 1
fi

# prestart: build the identity embed the SPA needs (best-effort; don't block boot).
"$NODE" scripts/build-identity-embed.js || echo "WARN: identity-embed build failed" >&2

# Plain `node server.js` (NOT --watch): as a launchd KeepAlive service, launchd
# owns crash-recovery — it respawns the tracked process on exit. `--watch` runs a
# supervisor+child, so a crashed child would leave the supervisor alive and defeat
# KeepAlive. For hot-reload during active dev, run `npm run dev` manually instead.
echo "Starting Fresh Context Studio with $NODE on :3440"
exec "$NODE" server.js
