#!/usr/bin/env bash
# One-shot setup for a fresh clone of mdxserve:
#   1. yarn install
#   2. yarn build
#   3. link bin/mdxserve    -> `mdxserve` on PATH system-wide (~/.local/bin or /usr/local/bin),
#                             independent of the current nvm/volta node version
#   4. npx skills add      -> ./skills registered with Claude Code, Codex, and ~/.agents/skills
#   5. unregister the old MCP server (`mdxserve mcp`, removed) from claude/codex, if present
#
# Safe to re-run. Re-run after editing ./skills (the skills CLI copies them, it
# doesn't symlink back to this repo).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

step() { printf '\n==> %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

for arg in "$@"; do
  die "unknown flag: $arg (usage: ./setup.sh)"
done

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

step "Installing the mdxserve launcher"
# A symlink to bin/mdxserve rather than `npm link`: npm's global bin lives
# inside the active node version's prefix (nvm/volta), so a link there
# disappears whenever you switch versions.
command -v node > .node-path   # pinned node for bin/mdxserve (gitignored)
if [ -d "$HOME/.local/bin" ] || mkdir -p "$HOME/.local/bin" 2>/dev/null; then
  bin_dir="$HOME/.local/bin"
elif [ -w /usr/local/bin ]; then
  bin_dir="/usr/local/bin"
else
  die "no writable bin directory (tried ~/.local/bin and /usr/local/bin)"
fi
launcher="$bin_dir/mdxserve"
ln -sfn "$(pwd)/bin/mdxserve" "$launcher"
echo "linked $launcher -> $(pwd)/bin/mdxserve"
# Clean up a stale npm link from earlier versions of this script, if present.
if npm ls -g --depth=0 mdxserve >/dev/null 2>&1; then
  echo "removing old npm link"
  npm unlink -g mdxserve >/dev/null 2>&1 || true
fi

step "Installing skills from ./skills"
if [ -n "$(find skills -name SKILL.md -print -quit 2>/dev/null)" ]; then
  npx -y skills add ./skills -g -a claude-code codex universal -s '*' -y
else
  echo "no skills in ./skills yet, skipping"
fi

step "Removing the old MCP registration"
# Earlier versions registered `mdxserve mcp` with claude/codex; that command
# no longer exists, so unregister it if it is still there.
if command -v claude >/dev/null; then
  claude mcp remove -s user mdxserve >/dev/null 2>&1 && echo "removed from claude" || true
fi
if command -v codex >/dev/null; then
  codex mcp remove mdxserve >/dev/null 2>&1 && echo "removed from codex" || true
fi

step "Done"
case ":$PATH:" in
  *":$bin_dir:"*) echo "mdxserve -> $launcher" ;;
  *) echo "mdxserve installed to $launcher, but $bin_dir is not on your PATH — add it to your shell profile:"
     echo "  export PATH=\"$bin_dir:\$PATH\"" ;;
esac
echo "Re-run ./setup.sh after changing ./skills to refresh the installed copies."
