#!/bin/sh
# BAOYU_CODEX_IMAGEGEN_BIN for `pmv art`. Runs baoyu-image-gen's bundled codex-imagegen ($PMV_CODEX_IMAGEGEN) unchanged,
# with the `codex` shim next to this file first on PATH. `--retries 0` (the last value wins) leaves retries to
# `pmv art`, which records every attempt; the provider cannot pass 0 itself.
set -eu
PMV_REAL_CODEX=$(command -v codex) || { echo "codex is not on PATH" >&2; exit 127; }
export PMV_REAL_CODEX
PATH="$(cd "$(dirname "$0")" && pwd):$PATH"
export PATH
exec bun "$PMV_CODEX_IMAGEGEN" "$@" --retries 0
