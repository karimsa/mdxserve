import fs from "node:fs";
import path from "node:path";
import { resolveFromPkg } from "../../infra/pkg.js";

const EXCLUDED_DIRS = new Set([
	"node_modules",
	".git",
	"venv",
	".venv",
	"dist",
	"build",
	"target",
	"__pycache__",
	".cache",
	".mdxserve",
]);

const SOURCE_FILE_PATTERN = /\.(tsx?|mdx?)$/;

/**
 * Every `.ts`/`.tsx`/`.md`/`.mdx` file under `dir`, skipping the same
 * directories `renderAppCss`'s `@source not` globs skip, plus `design-ref`
 * (design reference material, never shipped).
 */
export function listSourceFiles(dir: string): string[] {
	const files: string[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return files;
	}
	for (const entry of entries) {
		if (entry.name === "design-ref" || EXCLUDED_DIRS.has(entry.name)) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...listSourceFiles(full));
		else if (SOURCE_FILE_PATTERN.test(entry.name)) files.push(full);
	}
	return files;
}

/**
 * Every lucide icon name, straight from the package's own dynamic-import
 * map. `require.resolve` needs the concrete `.mjs` file — the package has no
 * "exports" map, so an extensionless `lucide-react/dynamicIconImports`
 * specifier only resolves through a bundler's own resolution, not Node's.
 */
export async function loadLucideNames(): Promise<ReadonlySet<string>> {
	const dynamicIconImportsFile = resolveFromPkg("lucide-react/dynamicIconImports.mjs");
	const dynamicIconImportsModule = (await import(dynamicIconImportsFile)) as {
		default: Record<string, unknown>;
	};
	return new Set(Object.keys(dynamicIconImportsModule.default));
}

/** PascalCase, the export name lucide-react's icon modules use. */
export function toPascalCase(kebabName: string): string {
	return kebabName
		.split("-")
		.filter(Boolean)
		.map((part) => part[0]!.toUpperCase() + part.slice(1))
		.join("");
}

/** kebab-case, the key lucide-react's `dynamicIconImports` map uses. */
export function toKebabCase(pascalName: string): string {
	return pascalName
		.replace(/([a-z])([A-Z0-9])/g, "$1-$2")
		.replace(/([0-9])([A-Za-z])/g, "$1-$2")
		.toLowerCase();
}

/**
 * Every lucide icon name referenced across `files`: any quoted kebab literal
 * that happens to be a lucide name (covers `icon="…"`, `name="…"`, ternaries)
 * plus PascalCase named imports from `"lucide-react"`, kebab-cased. A name
 * built at runtime (`icon={"ro" + "cket"}`) is invisible to this scan — same
 * as the live client, where an unknown name already renders nothing.
 */
export function collectIconNames(files: string[], lucideNames: ReadonlySet<string>): Set<string> {
	const found = new Set<string>();
	for (const file of files) {
		let text: string;
		try {
			text = fs.readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const match of text.matchAll(/["'`]([a-z][a-z0-9-]*)["'`]/g)) {
			const candidate = match[1]!;
			if (lucideNames.has(candidate)) found.add(candidate);
		}
		for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g)) {
			for (const rawSpecifier of match[1]!.split(",")) {
				const importedName = rawSpecifier.trim().split(/\s+/)[0];
				if (!importedName || importedName === "icons" || importedName === "type") continue;
				const kebabName = toKebabCase(importedName);
				if (lucideNames.has(kebabName)) found.add(kebabName);
			}
		}
	}
	return found;
}
