import path from "node:path";
import fs from "node:fs";

const IGNORED_NAMES = new Set(["node_modules"]);

export function isServable(name: string): boolean {
	if (name.startsWith(".")) return false;
	if (IGNORED_NAMES.has(name)) return false;
	return true;
}

export function isDocFile(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	return ext === ".md" || ext === ".mdx";
}

/** Check both the requested path and its symlink target against a publishable root. */
export function isPublicPath(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) return false;
	if (relative !== "" && !relative.split(path.sep).every(isServable)) return false;
	try {
		const realRoot = fs.realpathSync.native(root);
		const realCandidate = fs.realpathSync.native(candidate);
		const realRelative = path.relative(realRoot, realCandidate);
		return (
			realRelative === "" ||
			(!realRelative.startsWith("..") &&
				!path.isAbsolute(realRelative) &&
				realRelative.split(path.sep).every(isServable))
		);
	} catch {
		return false;
	}
}
