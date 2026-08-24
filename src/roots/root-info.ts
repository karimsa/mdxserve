import path from "node:path";

export interface RootInfo {
	name: string;
	/** Absolute filesystem path, no trailing slash. */
	dir: string;
}

export function rootNameOf(root: string): string {
	return path.basename(root) || root;
}

/** The `RootInfo` for `root`, falling back to a freshly computed one if it isn't in `rootInfos`. */
export function rootInfoFor(rootInfos: RootInfo[], root: string): RootInfo {
	return rootInfos.find((info) => info.dir === root) ?? { name: rootNameOf(root), dir: root };
}

/** Display names for every mounted root: basename, disambiguated with the parent dir on collision. */
export function computeRootInfos(roots: string[]): RootInfo[] {
	const counts = new Map<string, number>();
	for (const root of roots) {
		const name = rootNameOf(root);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return roots.map((dir) => {
		const name = rootNameOf(dir);
		if ((counts.get(name) ?? 0) <= 1) return { name, dir };
		return { name: `${name} (${path.basename(path.dirname(dir))})`, dir };
	});
}

/** Whether `child` is strictly inside `parent` (both absolute paths). */
export function isInside(parent: string, child: string): boolean {
	const rel = path.relative(parent, child);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Dedupe a list of absolute roots and drop any root that sits inside another
 * one, keeping the outer. A single `serve` refuses nested roots outright; the
 * stdio bridge unions roots from independent servers, so it has to reconcile
 * them here instead — otherwise the shared docs would be listed and indexed
 * twice and `resolveRoot`'s first match would be order-dependent.
 */
export function pruneNestedRoots(roots: string[]): string[] {
	const unique = [...new Set(roots)];
	return unique.filter((root) => !unique.some((other) => other !== root && isInside(other, root)));
}
