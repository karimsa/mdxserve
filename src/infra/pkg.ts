import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
