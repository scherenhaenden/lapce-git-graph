#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

TARGET_DIR="$HOME/.local/share/lapce-stable/plugins/scherenhaenden.git-graph"

echo "Installing Git Graph locally for Lapce..."
mkdir -p "$TARGET_DIR"

cp -v volt.toml "$TARGET_DIR/"
cp -v lapce-git-graph.wasm "$TARGET_DIR/"
cp -v icon.svg "$TARGET_DIR/"
cp -v README.md "$TARGET_DIR/"
cp -v server.js "$TARGET_DIR/"
mkdir -p "$TARGET_DIR/web"
cp -v web/* "$TARGET_DIR/web/"

echo "Installed successfully to $TARGET_DIR"
echo "Restart Lapce or check Lapce plugins to use it!"
