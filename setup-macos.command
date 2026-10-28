#!/bin/sh
cd "$(dirname "$0")" || exit 1
node -e "if (process.versions.node.split('.')[0] < 24) process.exit(1)" 2>/dev/null || { echo "Node.js 24 or newer is required: https://nodejs.org"; exit 1; }
node src/setup.ts
