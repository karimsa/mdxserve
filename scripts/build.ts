import { $ } from "zx";

const cliBanner = "--banner:js=#!/usr/bin/env node";

await $`tsx scripts/build-registry.ts`;
await $`esbuild src/index.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=dist/cli.js ${cliBanner}`;
await $`esbuild src/rendering/render-worker.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=dist/render-worker.js`;
