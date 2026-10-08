#!/usr/bin/env bash
# Pack mdxserve, install the tarball into a throwaway global prefix, and run it the way a user
# would. This is the only check that exercises the published layout (dist/ + client/ next to
# a real node_modules) rather than the source checkout.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tarball="$(npm pack --pack-destination "$tmp" --silent | tail -n 1)" # prepack runs yarn build
# npm consumers do not use yarn.lock. Exercise fresh resolution and fail if
# incompatible transitive peers or deprecated packages make installation noisy.
npm install -g --strict-peer-deps --prefix "$tmp/prefix" "$tmp/$tarball" 2>&1 | tee "$tmp/install.log"
if grep -Ei '^npm (warn|WARN)( |:)' "$tmp/install.log"; then
  echo "Packed install emitted npm warnings" >&2
  exit 1
fi
bin="$tmp/prefix/bin/mdxserve"
test "$("$bin" --version)" = "$(node -p "require('./package.json').version")"
"$bin" --help | grep -q "^  setup"
"$bin" components search Callout | grep -q Callout
"$bin" components show Callout --json | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))'
MDXSERVE_HOME="$tmp/home" "$bin" validate example/01-markdown.md     # static checks, no server
XDG_CACHE_HOME="$tmp/cache" "$bin" export example/01-markdown.md -o "$tmp/out.html"
test -s "$tmp/out.html"
echo "smoke ok"
