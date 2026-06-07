#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export PATH="/Users/binxuwang/.nvm/versions/node/v22.17.1/bin:/Users/binxuwang/miniforge3/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

exec pnpm run dev
