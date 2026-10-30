#!/usr/bin/env bash
# Static checks, then fixture assertions in headless Chromium (light + dark).
# Usage: tests/run.sh            (set CHROME=/path/to/browser to override)
set -euo pipefail
cd "$(dirname "$0")/.."
node tests/check.js
node tests/run-fixtures.js
node tests/run-fixtures.js --dark
