import path from "node:path";
import fsp from "node:fs/promises";
import type { RootInfo } from "../roots/root-info.js";
import { resolveRoot } from "../roots/paths.js";
import { isDocFile, isServable } from "../roots/servable.js";
import { contentTypeOf } from "./content-type.js";

export type AssetLookup =
	| {
			kind: "ok";
			/** The file's real path, inside the real path of the root that holds it. */
			abs: string;
			size: number;
			mtimeMs: number;
			contentType: string;
	  }
	| { kind: "not-found"; message: string };

/**
 * Names refused in every mode, after the defaults the server's file route applied when Vite
 * served it (`server.fs.deny`): the git directory, environment files and keys.
 */
function isDeniedName(name: string): boolean {
	const lower = name.toLowerCase();
	return (
		lower === ".git" ||
		lower === ".env" ||
		lower.startsWith(".env.") ||
		lower.endsWith(".pem") ||
		lower.endsWith(".crt")
	);
}

/** Whether every segment of `relative` may be served, for a full reader or a public one. */
function segmentsAllowed(relative: string, publicOnly: boolean): boolean {
	const segments = relative.split(path.sep).filter(Boolean);
	return segments.every(
		(segment) => !isDeniedName(segment) && (!publicOnly || isServable(segment)),
	);
}

/** Whether `child` is `parent` or inside it (both absolute). */
function within(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Finds a non-document file in a mounted root for the `getAsset` endpoint, the one way a
 * client loads an image or other file a document points at.
 */
export class AssetsService {
	constructor(private readonly roots: RootInfo[]) {}

	/**
	 * Locate the file at absolute path `input`. Refused: a path outside every mounted root,
	 * lexically (`..` is collapsed first) or through a symlink; a `.md` or `.mdx` file under
	 * either name, since clients read documents as JSON; a file under `.git`, an environment
	 * file or a key; anything that is not a regular file. A public reader (`publicOnly`) is
	 * also refused any hidden or `node_modules` segment, in the path as asked and in the
	 * path it really resolves to.
	 */
	async locate(input: string, publicOnly: boolean): Promise<AssetLookup> {
		const notFound: AssetLookup = { kind: "not-found", message: `${input} not found` };
		if (!path.isAbsolute(input) || input.includes("\0")) return notFound;
		const dirs = this.roots.map((info) => info.dir);

		let realFile: string;
		try {
			realFile = await fsp.realpath(input);
		} catch {
			return notFound;
		}
		// Roots are stored as real paths, so a path through an alias of a root
		// (`/tmp` for `/private/tmp`) is matched by its real path instead.
		const hit = resolveRoot(dirs, input) ?? resolveRoot(dirs, realFile);
		if (!hit) return { kind: "not-found", message: `${input} is outside every served directory` };

		let realRoot: string;
		try {
			realRoot = await fsp.realpath(hit.root);
		} catch {
			return notFound;
		}
		if (!within(realRoot, realFile)) {
			return { kind: "not-found", message: `${input} is outside every served directory` };
		}
		if (isDocFile(hit.abs) || isDocFile(realFile)) return notFound;
		if (
			!segmentsAllowed(path.relative(hit.root, hit.abs), publicOnly) ||
			!segmentsAllowed(path.relative(realRoot, realFile), publicOnly)
		) {
			return notFound;
		}

		let stat;
		try {
			stat = await fsp.stat(realFile);
		} catch {
			return notFound;
		}
		if (!stat.isFile()) return notFound;
		return {
			kind: "ok",
			abs: realFile,
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			contentType: contentTypeOf(realFile),
		};
	}
}
