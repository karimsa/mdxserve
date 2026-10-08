import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

let cachedRoot: string | undefined;

/**
 * Locate the root of the mdxserve package itself (not the directory being
 * served). Works whether we're running from `src/index.ts` via tsx (dev) or
 * from the bundled `dist/cli.js` (built), by walking up from this module's
 * location until a `package.json` with `"name": "@karimsa/mdxserve"` is found.
 */
export function getPackageRoot(): string {
	if (cachedRoot) return cachedRoot;

	let dir = path.dirname(fileURLToPath(import.meta.url));

	while (true) {
		const pkgPath = path.join(dir, "package.json");
		if (fs.existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
				if (pkg.name === "@karimsa/mdxserve") {
					cachedRoot = dir;
					return dir;
				}
			} catch {
				// malformed package.json; keep walking up
			}
		}

		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(
				'mdxserve: could not locate package root (no package.json named "@karimsa/mdxserve" found)',
			);
		}
		dir = parent;
	}
}

/** Resolve `specifier` from mdxserve's own package root, not the caller's cwd. */
export function resolveFromPkg(specifier: string): string {
	return require.resolve(specifier, { paths: [getPackageRoot()] });
}

/**
 * The on-disk directory of a package whose package.json is not in its
 * "exports" map (so `resolveFromPkg("<name>/package.json")` would throw):
 * resolve its entry file, then walk up to the nearest package.json that
 * actually declares that name (skipping any nested one in a dist/ folder).
 */
export function packageDir(name: string): string {
	let dir = path.dirname(resolveFromPkg(name));
	for (;;) {
		const manifest = path.join(dir, "package.json");
		if (fs.existsSync(manifest)) {
			const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")) as { name?: string };
			if (pkg.name === name) return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) throw new Error(`Cannot locate package directory for ${name}`);
		dir = parent;
	}
}

/**
 * Directories Vite may serve dependency files from: <pkgRoot>/node_modules plus, when
 * pkgRoot itself sits inside a node_modules folder (npx, global, local install), that folder.
 */
export function dependencyRoots(pkgRoot: string): string[] {
	const roots = [path.join(pkgRoot, "node_modules")];
	const parent = path.dirname(pkgRoot);
	if (path.basename(parent) === "node_modules") roots.push(parent);
	return roots;
}

export function readPackageVersion(): string {
	const manifest = JSON.parse(
		fs.readFileSync(path.join(getPackageRoot(), "package.json"), "utf8"),
	) as {
		version: string;
	};
	return manifest.version;
}

export function missingBuildArtifact(relPath: string): string {
	return `mdxserve: ${relPath} is missing. Reinstall with "npm i -g @karimsa/mdxserve", or run "yarn build" in a source checkout.`;
}
