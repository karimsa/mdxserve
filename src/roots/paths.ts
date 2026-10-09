import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { isServable } from "./servable.js";

/**
 * Expand a leading `~` (`~` alone or `~/…`) to `home`. Shells normally do this
 * before we see the argument, but not when the value is quoted, glued to the
 * flag (`-w~/docs`), or comes from a config file. `~user`
 * forms and a `~` anywhere else are left alone.
 */
export function expandHome(input: string, home: string): string {
	if (input === "~") return home;
	if (input.startsWith("~/")) return path.join(home, input.slice(2));
	return input;
}

/** The mounted root that contains `absPath`, or null if it lies outside all of them. */
export function resolveRoot(
	roots: string[],
	absPath: string,
): { root: string; abs: string } | null {
	const abs = path.resolve("/", absPath); // collapses ".." segments; never relative
	for (const root of roots) {
		const rel = path.relative(root, abs);
		if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return { root, abs };
	}
	return null;
}

/**
 * `resolveRoot`, falling back to the path's realpath when the lexical match
 * fails: roots are stored as realpaths, so an absolute path that reaches a
 * root through a symlink alias (`/tmp/x` for `/private/tmp/x` on macOS)
 * would otherwise be rejected even though its target is inside the root.
 */
async function resolveRootFollowingLinks(
	roots: string[],
	absPath: string,
): Promise<{ root: string; abs: string } | null> {
	const lexical = resolveRoot(roots, absPath);
	if (lexical) return lexical;
	try {
		return resolveRoot(roots, await fsp.realpath(absPath));
	} catch {
		return null;
	}
}

export type ResolvedDoc = { ok: true; abs: string; root: string } | { ok: false; error: string };

/**
 * Resolve a doc path the way the site does: an absolute path is located in
 * whichever mounted root contains it, and a root-relative path is accepted
 * when exactly one root has a file at that location. Then apply the same
 * safety checks as the server's doc-serving route: per-segment servability,
 * a realpath containment check (so a symlinked directory can't point outside
 * its root), and a .md/.mdx regular-file check. Public readers also reject
 * symlinks whose target has a hidden segment inside the root.
 *
 * When `roots` is empty (no mdxserve server running), only an absolute path
 * can be resolved — there's nothing to resolve a relative path against — and
 * the containment check is skipped. Every other check still applies.
 */
export async function resolveDocPath(
	roots: string[],
	input: string,
	publicOnly = false,
): Promise<ResolvedDoc> {
	let hit: { root: string; abs: string } | null;
	if (path.isAbsolute(input)) {
		if (roots.length === 0) {
			const abs = path.resolve("/", input);
			hit = { root: path.dirname(abs), abs };
		} else {
			hit = await resolveRootFollowingLinks(roots, input);
			if (!hit) return { ok: false, error: `${input} is outside every served directory` };
		}
	} else {
		const candidates: { root: string; abs: string }[] = [];
		for (const root of roots) {
			const candidate = resolveRoot([root], path.join(root, input));
			if (!candidate) continue;
			try {
				await fsp.access(candidate.abs);
				candidates.push(candidate);
			} catch {
				// not in this root
			}
		}
		if (candidates.length === 0)
			return { ok: false, error: `${input} not found in any served directory` };
		if (candidates.length > 1) {
			return {
				ok: false,
				error: `${input} exists in more than one served directory; use an absolute path: ${candidates.map((candidate) => candidate.abs).join(", ")}`,
			};
		}
		hit = candidates[0];
	}

	const { root, abs } = hit;
	if (abs === root) return { ok: false, error: "not a file" };

	const rel = path.relative(root, abs);
	if (!rel.split(path.sep).filter(Boolean).every(isServable)) {
		return { ok: false, error: `${abs} is not a servable path` };
	}

	// Follow symlinks on the file itself, like the site's doc route (`stat`,
	// not `lstat`), but require the real file to stay inside the real root so
	// a link can't reach outside it. With no roots there is nothing to be
	// contained in, so only existence is checked.
	let realFile: string;
	try {
		realFile = await fsp.realpath(abs);
	} catch {
		return { ok: false, error: `${abs} not found` };
	}
	if (roots.length > 0) {
		let realRoot: string;
		try {
			realRoot = await fsp.realpath(root);
		} catch {
			return { ok: false, error: `${abs} not found` };
		}
		const relReal = path.relative(realRoot, realFile);
		if (
			relReal.startsWith("..") ||
			path.isAbsolute(relReal) ||
			(publicOnly && !relReal.split(path.sep).filter(Boolean).every(isServable))
		) {
			return { ok: false, error: `${abs} is outside every served directory` };
		}
	}

	let st;
	try {
		st = await fsp.stat(realFile);
	} catch {
		return { ok: false, error: `${abs} not found` };
	}
	if (!st.isFile()) return { ok: false, error: `${abs} is not a file` };

	const ext = path.extname(abs).toLowerCase();
	if (ext !== ".md" && ext !== ".mdx") return { ok: false, error: `${abs} is not a .md/.mdx file` };

	return { ok: true, abs, root };
}

export type ResolvedDir = { ok: true; abs: string; root: string } | { ok: false; error: string };

/**
 * Resolve an absolute directory path inside a served root, with the same
 * realpath containment check as `resolveDocPath` so a symlinked directory
 * can't be used to list files outside every root. Public readers also reject
 * directory aliases whose target has a hidden segment.
 */
export async function resolveDirPath(
	roots: string[],
	input: string,
	publicOnly = false,
): Promise<ResolvedDir> {
	const hit = await resolveRootFollowingLinks(roots, input);
	if (!hit) return { ok: false, error: `${input} is outside every served directory` };

	const rel = path.relative(hit.root, hit.abs);
	if (!rel.split(path.sep).filter(Boolean).every(isServable)) {
		return { ok: false, error: `${hit.abs} is not a servable path` };
	}

	let realRoot: string;
	let realDir: string;
	try {
		realRoot = await fsp.realpath(hit.root);
		realDir = await fsp.realpath(hit.abs);
	} catch {
		return { ok: false, error: `${hit.abs} not found` };
	}
	const relReal = path.relative(realRoot, realDir);
	if (
		relReal.startsWith("..") ||
		path.isAbsolute(relReal) ||
		(publicOnly && !relReal.split(path.sep).filter(Boolean).every(isServable))
	) {
		return { ok: false, error: `${hit.abs} is outside every served directory` };
	}

	let st;
	try {
		st = await fsp.stat(realDir);
	} catch {
		return { ok: false, error: `${hit.abs} not found` };
	}
	if (!st.isDirectory()) return { ok: false, error: `${hit.abs} is not a directory` };

	return { ok: true, abs: hit.abs, root: hit.root };
}

/** Extensions Vite tries, in order, for an extensionless relative import. */
const IMPORT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".mdx", ".md", ".json", ".css"];

/**
 * Whether a relative import specifier from `fromFile` resolves to something
 * on disk the way Vite would: the literal path, the path plus a known
 * extension, or a directory index file.
 */
export function importResolves(fromFile: string, specifier: string): boolean {
	const base = path.resolve(path.dirname(fromFile), specifier);
	const candidates = [base, ...IMPORT_EXTENSIONS.map((ext) => base + ext)];
	for (const candidate of candidates) {
		try {
			if (fs.statSync(candidate).isFile()) return true;
		} catch {
			// keep looking
		}
	}
	try {
		if (fs.statSync(base).isDirectory()) {
			return IMPORT_EXTENSIONS.some((ext) => fs.existsSync(path.join(base, `index${ext}`)));
		}
	} catch {
		// not a directory either
	}
	return false;
}
