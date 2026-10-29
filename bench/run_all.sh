#!/usr/bin/env bash
# Full sweep: 3 arms x N tasks x N reps, sequential, arm order shuffled per rep.
# Usage: ./run_all.sh [reps]        env: ARGUS_BENCH_MODEL, ARGUS_BENCH_WORK
set -euo pipefail
cd "$(dirname "$0")"
REPS="${1:-3}"
node setup.mjs
node fetch.mjs || true
node run.mjs --arms none,skill,argus --reps "$REPS" --shuffle
node report.mjs --results results/run.jsonl
