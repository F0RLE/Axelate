#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

NODE_BIN="${AXELATE_DEPS_DIR:-$HOME/Axelate-deps}/node/node"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="node"
fi

"$NODE_BIN" .github/scripts/workflow.mjs dev:inspect "$@"
