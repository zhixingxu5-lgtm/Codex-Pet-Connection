#!/bin/sh
set -eu

if [ -x "$PLUGIN_ROOT/bin/macos/petlink-hook" ]; then
  exec "$PLUGIN_ROOT/bin/macos/petlink-hook"
fi

exec node "$PLUGIN_ROOT/scripts/petlink-hook.mjs"
