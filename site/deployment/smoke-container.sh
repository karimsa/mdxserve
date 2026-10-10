#!/usr/bin/env bash
set -euo pipefail

image_name=mdxserve-site
container_name="mdxserve-site-smoke-$$"
base_url=http://127.0.0.1:18080
response_file="$(mktemp)"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -f "$response_file"
}
trap cleanup EXIT

node site/deployment/prepare-context.mjs
docker build -f site/Dockerfile.vercel -t "$image_name" site
docker run -d --name "$container_name" -p 127.0.0.1:18080:8080 "$image_name" >/dev/null

ready=false
for attempt in $(seq 1 60); do
  if curl --silent --fail --max-time 3 -H 'Host: smoke.vercel.app' -H 'Accept: text/html' \
    "$base_url/srv/docs/README.mdx" -o "$response_file"; then
    ready=true
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$container_name")" != true ]; then
    docker logs "$container_name"
    exit 1
  fi
  sleep 2
done

if [ "$ready" != true ]; then
  docker logs "$container_name"
  echo 'Site container did not become ready' >&2
  exit 1
fi

grep -q 'data-permissions="restricted"' "$response_file"
grep -q 'data-same-machine="0"' "$response_file"
grep -q '"kind":"doc"' "$response_file"

entry_path="$(sed -n '/client\/entry.tsx/s/.*<script type="module" src="\([^"]*\)".*/\1/p' "$response_file")"
test -n "$entry_path"
asset_type="$(curl --silent --fail --max-time 15 -H 'Host: smoke.vercel.app' \
  -o "$response_file" -w '%{content_type}' "$base_url$entry_path")"
case "$asset_type" in
  text/javascript*) ;;
  *) echo "Unexpected client module content type: $asset_type" >&2; exit 1 ;;
esac

custom_host_type="$(curl --silent --fail --max-time 15 -H 'Host: mdxserve.karim.build' \
  -o "$response_file" -w '%{content_type}' "$base_url/@vite/client")"
case "$custom_host_type" in
  text/javascript*) ;;
  *) echo "Vite client blocked on custom domain: $custom_host_type" >&2; exit 1 ;;
esac

doc_type="$(curl --silent --fail --max-time 15 -H 'Host: smoke.vercel.app' \
  -o "$response_file" -w '%{content_type}' "$base_url/@fs/srv/docs/README.mdx")"
case "$doc_type" in
  text/javascript*) ;;
  *) echo "Unexpected MDX module content type: $doc_type" >&2; exit 1 ;;
esac
if grep -q 'Failed to compile' "$response_file"; then
  echo 'Site MDX module failed to compile' >&2
  exit 1
fi

status="$(curl --silent --max-time 15 -o "$response_file" -w '%{http_code}' \
  -H 'Host: smoke.vercel.app' \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://smoke.vercel.app' \
  --data '{"json":{"dirs":["/tmp"]}}' \
  "$base_url/__mdxserve/trpc/addRoots")"
test "$status" = 403
grep -q 'FORBIDDEN' "$response_file"

echo 'Site container served the public doc and client module with restricted writes.'
