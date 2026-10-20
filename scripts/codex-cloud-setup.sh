#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Palette Link requires Node.js 24 or newer for tests. Select Node.js 24 in the cloud environment."); process.exit(1); }'
npm ci --no-audit --no-fund
printf '%s\n' 'Palette Link setup complete. Run npm test and npm run build.'
