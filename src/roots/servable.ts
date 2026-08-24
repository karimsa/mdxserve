import path from "node:path";

const IGNORED_NAMES = new Set(["node_modules"]);

export function isServable(name: string): boolean {
	if (name.startsWith(".")) return false;
	if (IGNORED_NAMES.has(name)) return false;
	return true;
}

export function isDocFile(p: string): boolean {
	const ext = path.extname(p).toLowerCase();
	return ext === ".md" || ext === ".mdx";
}
