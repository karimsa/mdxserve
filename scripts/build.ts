import * as esbuild from "esbuild";
import { $ } from "zx";

const buildOptions = {
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	packages: "external",
	logLevel: "info",
} satisfies esbuild.BuildOptions;

await $`tsx scripts/build-registry.ts`;
await esbuild.build({
	...buildOptions,
	entryPoints: ["src/index.ts"],
	outfile: "dist/cli.js",
	banner: { js: "#!/usr/bin/env node" },
});
await esbuild.build({
	...buildOptions,
	entryPoints: ["src/rendering/render-worker.ts"],
	outfile: "dist/render-worker.js",
});
