#!/usr/bin/env bash
# Pack mdxserve, install the tarball into a throwaway global prefix without dev dependencies,
# and run it the way a user would. This is the only check that exercises the published
# layout (dist/ with the prebuilt client next to a real node_modules) rather than the source
# checkout.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." # packages/server
examples="$(cd ../../example && pwd -P)"
tmp="$(mktemp -d)"
server_pid=""
cleanup() {
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
tarball="$(npm pack --pack-destination "$tmp" --silent | tail -n 1)" # prepack runs yarn build
# prepack copies these in from the repository root.
tar -tzf "$tmp/$tarball" >"$tmp/contents.txt"
grep -qx 'package/README.md' "$tmp/contents.txt"
grep -qx 'package/LICENSE' "$tmp/contents.txt"
# npm consumers do not use yarn.lock. Exercise fresh resolution and fail if
# incompatible transitive peers or deprecated packages make installation noisy.
npm install -g --omit=dev --strict-peer-deps --prefix "$tmp/prefix" "$tmp/$tarball" 2>&1 | tee "$tmp/install.log"
if grep -Ei '^npm (warn|WARN)( |:)' "$tmp/install.log"; then
  echo "Packed install emitted npm warnings" >&2
  exit 1
fi

# The server ships a prebuilt client, so no build tool is installed with it.
if npm ls -g --prefix "$tmp/prefix" --all --omit=dev vite | grep -q 'vite@'; then
  npm ls -g --prefix "$tmp/prefix" --all --omit=dev vite >&2 || true
  echo "vite is in the installed dependency tree" >&2
  exit 1
fi
if find "$tmp/prefix" -path '*/node_modules/vite/package.json' | grep -q .; then
  echo "vite is installed under the prefix" >&2
  exit 1
fi

# The workspace packages are private, so the bundles must inline them.
if grep -l '@mdxserve/' "$tmp"/prefix/lib/node_modules/@karimsa/mdxserve/dist/*.js; then
  echo "a built server file still imports a workspace package" >&2
  exit 1
fi

bin="$tmp/prefix/bin/mdxserve"
test "$("$bin" --version)" = "$(node -p "require('./package.json').version")"
"$bin" --help | grep -q "^  setup"
"$bin" components search Callout | grep -q Callout
"$bin" components show Callout --json | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))'
MDXSERVE_HOME="$tmp/home" "$bin" validate "$examples/01-markdown.md"     # static checks, no server

# Serve example/ and fetch what a browser does: the shell, a built asset, a document and an image.
port="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
MDXSERVE_HOME="$tmp/home" "$bin" serve -p "$port" -w "$examples" >"$tmp/serve.log" 2>&1 &
server_pid=$!
base="http://127.0.0.1:$port"
for _ in $(seq 1 100); do
  curl -sf -o /dev/null "$base/favicon.ico" && break
  sleep 0.2
done
page="$(node -e 'console.log(encodeURI(process.argv[1]))' "$examples/01-markdown.md")"
curl -sf -H 'Accept: text/html' "$base$page" >"$tmp/shell.html" || {
  cat "$tmp/serve.log" >&2
  exit 1
}
grep -q 'id="__mdxserve_route"' "$tmp/shell.html"
asset="$(grep -oE '/__mdxserve/assets/index-[A-Za-z0-9_-]+\.js' "$tmp/shell.html" | head -n 1)"
test -n "$asset"
curl -sf -D "$tmp/asset.headers" -o /dev/null "$base$asset"
grep -qi '^cache-control: public, max-age=31536000, immutable' "$tmp/asset.headers"
input="$(node -e 'console.log(encodeURIComponent(JSON.stringify({ path: process.argv[1] })))' "$examples/01-markdown.md")"
curl -sf "$base/__mdxserve/trpc/getDocument?input=$input" >"$tmp/document.json"
image="$(node -e '
  const body = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const tree = body.result.data.document;
  if (tree.schemaVersion !== 1) throw new Error("unexpected schemaVersion");
  const found = JSON.stringify(tree).match(/"src":"(\/__mdxserve\/getAsset\?[^"]+)"/);
  if (!found) throw new Error("no getAsset image in the document");
  console.log(found[1]);
' "$tmp/document.json")"
curl -sf -o "$tmp/logo.png" "$base$image"
cmp -s "$tmp/logo.png" "$examples/assets/logo.png"
# The smoke server listens on loopback with no tailscale serve address, so no other device can
# open it: `mdxserve qr` must say so and exit 1.
if MDXSERVE_HOME="$tmp/home" "$bin" qr >"$tmp/qr.out" 2>"$tmp/qr.err"; then
  echo "mdxserve qr succeeded against a loopback-only server" >&2
  exit 1
fi
grep -q 'no other device can open it' "$tmp/qr.err"
echo "smoke ok"
