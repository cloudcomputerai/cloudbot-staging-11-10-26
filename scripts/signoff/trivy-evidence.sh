#!/usr/bin/env bash
# Local cron equivalent of .github/workflows/trivy-evidence.yml.
# This script never signs anything. The scan report is evidence, not a signature,
# and it does not record an officer's decision.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
out="${1:-$root/deploy/signoff/evidence}"
mkdir -p "$out"

# The operator's trivy binary. This script does not vendor Trivy.
trivy fs --format sarif --output "$out/trivy-results.sarif" --exit-code 0 "$root"
trivy fs --format json --output "$out/trivy-results.json" --exit-code 0 "$root"
