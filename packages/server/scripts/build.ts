import fs from "node:fs";
import * as esbuild from "esbuild";
import { build as viteBuild } from "vite";
import { $ } from "zx";

const buildOptions = {
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	packages: "external",
	logLevel: "info",
	metafile: true,
} satisfies esbuild.BuildOptions;

/** `@scope/name/sub/path` or `name/sub/path` → the package name. */
function packageNameOf(specifier: string): string {
	const segments = specifier.split("/");
	return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

/**
 * The server bundles keep every package external, so a published install resolves them
 * from `dependencies`. Fail the build when one of them imports a package that is only a
 * dev dependency (the client's packages are, since dist/client is prebuilt).
 */
function assertRuntimeDependencies(results: esbuild.BuildResult<typeof buildOptions>[]): void {
	const manifest = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
		dependencies: Record<string, string>;
	};
	const missing = new Set<string>();
	for (const result of results) {
		for (const output of Object.values(result.metafile.outputs)) {
			for (const imported of output.imports) {
				if (!imported.external || imported.path.startsWith("node:")) continue;
				const name = packageNameOf(imported.path);
				if (!(name in manifest.dependencies)) missing.add(name);
			}
		}
	}
	if (missing.size > 0) {
		throw new Error(
			`The server imports packages missing from "dependencies": ${[...missing].join(", ")}`,
		);
	}
}

// Start from an empty dist/, so a file an older build wrote (or one this build no
// longer makes) is never packed.
fs.rmSync("dist", { recursive: true, force: true });
// The builtins import client/state.ts, whose localStorage access makes Node 25+
// warn without --localstorage-file; the registry never needs storage.
await $`tsx --no-experimental-webstorage scripts/build-registry.ts`;
const server = await esbuild.build({
	...buildOptions,
	entryPoints: ["src/index.ts"],
	outfile: "dist/cli.js",
	banner: { js: "#!/usr/bin/env node" },
});
const worker = await esbuild.build({
	...buildOptions,
	entryPoints: ["src/diagrams/adapters/validate-worker.ts"],
	outfile: "dist/diagram-worker.js",
});
assertRuntimeDependencies([server, worker]);
// The browser client, into dist/client (vite.config.ts). Tailwind runs here only.
await viteBuild({ configFile: "vite.config.ts", logLevel: "warn" });
