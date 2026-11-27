import fs from "node:fs";
import * as esbuild from "esbuild";

/** Workspace packages are private (never on npm), so the bundles inline them. */
const WORKSPACE_SCOPE = "@mdxserve/";

/**
 * Keep every npm package external, as esbuild's `packages: "external"` does, except the
 * workspace packages, which are bundled.
 */
const externalPackages: esbuild.Plugin = {
	name: "external-packages",
	setup(build) {
		build.onResolve({ filter: /^[^./]/ }, (args) =>
			args.kind === "entry-point" || args.path.startsWith(WORKSPACE_SCOPE)
				? undefined
				: { path: args.path, external: true },
		);
	},
};

const buildOptions = {
	bundle: true,
	platform: "node",
	target: "node22",
	format: "esm",
	plugins: [externalPackages],
	logLevel: "info",
	metafile: true,
} satisfies esbuild.BuildOptions;

/** `@scope/name/sub/path` or `name/sub/path` → the package name. */
function packageNameOf(specifier: string): string {
	const segments = specifier.split("/");
	return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

/**
 * The server bundles keep every npm package external, so a published install resolves them
 * from `dependencies`. Fail the build when one of them imports a package that is only a
 * dev dependency (the client's packages are, since dist/client is prebuilt), or leaves a
 * workspace package as an import.
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
				if (name.startsWith(WORKSPACE_SCOPE) || !(name in manifest.dependencies)) {
					missing.add(name);
				}
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
// longer makes) is never packed. The web client's build writes dist/client and
// dist/registry.json afterwards (apps/web), so `yarn build` at the root runs this first.
fs.rmSync("dist", { recursive: true, force: true });
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
