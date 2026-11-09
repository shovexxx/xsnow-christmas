#!/usr/bin/env bash
# HermesXSnow installer — copies plugin.js into your Hermes desktop-plugins folder.
set -euo pipefail

# Resolve the plugin source: prefer a local plugin.js next to this script
# (clone install); fall back to downloading it (piped `curl | bash` install).
PLUGIN_SRC=""
SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [[ -n "$SCRIPT_PATH" && "$SCRIPT_PATH" != "-" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
  if [[ -f "$SCRIPT_DIR/plugin.js" ]]; then
    PLUGIN_SRC="$SCRIPT_DIR/plugin.js"
  fi
fi
if [[ -z "$PLUGIN_SRC" ]]; then
  PLUGIN_SRC="$(mktemp)"
  curl -fsSL https://raw.githubusercontent.com/shovexxx/xsnow-christmas/main/plugin.js -o "$PLUGIN_SRC"
fi

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DEST="$HERMES_HOME/desktop-plugins/xsnow-christmas"

mkdir -p "$DEST"
cp "$PLUGIN_SRC" "$DEST/plugin.js"

echo "Installed HermesXSnow -> $DEST/plugin.js"
echo "Now open Hermes desktop and run: Ctrl/Cmd+K -> Reload desktop plugins"
