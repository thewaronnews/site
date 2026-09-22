#!/usr/bin/env bash
# P0.3 publish verification against the live site. Real requests only.
set -uo pipefail
cd "$(dirname "$0")"
python3 verify-claims.py "$@"
