#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

TOKEN="${1:-Wcq4GeFspE0rKZQwxHOLLKh6AkvKh6kL}"

if [ -z "$TOKEN" ]; then
    echo "Usage: $0 [API_TOKEN]"
    exit 1
fi

echo "Packaging plugin..."
tar -cf - volt.toml lapce-git-graph.wasm README.md icon.svg | zstd > git-graph.volt

echo "Publishing to plugins.lapce.dev..."
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X PUT \
    -H "Authorization: Bearer $TOKEN" \
    --data-binary @git-graph.volt \
    https://plugins.lapce.dev/api/v1/plugins/new)

STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_STATUS:")

if [ "$STATUS" = "200" ]; then
    echo "SUCCESS: Plugin published successfully to https://plugins.lapce.dev/plugins/scherenhaenden/git-graph"
else
    echo "Response ($STATUS): $BODY"
fi
