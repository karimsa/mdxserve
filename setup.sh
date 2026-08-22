#!/usr/bin/env bash
# One-shot setup for a fresh clone of mdxserve:
#   1. yarn install
#   2. yarn build
#   3. npm link            -> `mdxserve` available from any folder
#   4. npx skills add      -> ./skills registered with Claude Code, Codex, and ~/.agents/skills
#
# Safe to re-run. Re-run after editing ./skills (the skills CLI copies them, it
# doesn't symlink back to this repo).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

step() { printf '\n==> %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

step "Checking prerequisites"
command -v node >/dev/null || die "node is required (https://nodejs.org)"
command -v npm  >/dev/null || die "npm is required"
if ! command -v yarn >/dev/null; then
  command -v corepack >/dev/null || die "yarn is required; install it or enable corepack (ships with node >= 16.10)"
  echo "yarn not found, enabling via corepack"
  corepack enable
fi
echo "node $(node --version), yarn $(yarn --version)"

step "Installing dependencies"
yarn install

step "Building"
yarn build

step "Linking mdxserve globally"
npm link

step "Installing skills from ./skills"
if [ -n "$(find skills -name SKILL.md -print -quit 2>/dev/null)" ]; then
  npx -y skills add ./skills -g -a claude-code codex universal -s '*' -y
else
  echo "no skills in ./skills yet, skipping"
fi

step "Done"
if bin="$(command -v mdxserve)"; then
  echo "mdxserve -> $bin"
else
  echo "mdxserve is not on PATH - make sure npm's global bin dir ($(npm prefix -g)/bin) is in your PATH"
fi
echo "Re-run ./setup.sh after changing ./skills to refresh the installed copies."
