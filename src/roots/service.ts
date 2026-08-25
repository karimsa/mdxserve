import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expandHome } from "./paths.js";
import { computeRootInfos, isInside, type RootInfo } from "./root-info.js";

export type AdmitRootsResult =
	| { kind: "ok"; roots: string[]; rootInfos: RootInfo[] }
	| { kind: "not-found"; message: string }
	| { kind: "not-a-directory"; message: string }
	/** Serving `/` would put the whole filesystem behind the doc routes. */
	| { kind: "refused"; message: string }
	| { kind: "nested"; message: string };

type ResolveInputsResult =
	| { kind: "ok"; roots: string[] }
	| { kind: "not-found"; message: string }
	| { kind: "not-a-directory"; message: string };

type SetConflict = { kind: "refused"; message: string } | { kind: "nested"; message: string };

export interface RootsChange {
	added: string[];
	removed: string[];
	roots: RootInfo[];
}

export type RootsListener = (change: RootsChange) => void | Promise<void>;

export type AddRootsResult =
	| { kind: "ok"; added: string[]; roots: RootInfo[] }
	| { kind: "not-found"; message: string }
	| { kind: "not-a-directory"; message: string }
	| { kind: "refused"; message: string }
	| { kind: "nested"; message: string };

export type RemoveRootsResult =
	{ kind: "ok"; removed: string[]; roots: RootInfo[] } | { kind: "not-mounted"; message: string };

/**
 * `fs.realpath`, but tolerant of a missing tail: when `abs` itself is gone,
 * resolve the deepest ancestor that still exists and re-append the missing
 * segments. `/tmp/gone` becomes `/private/tmp/gone` on macOS even though
 * `gone` no longer exists, which is what a stored root realpath looks like.
 */
async function realpathThroughMissingTail(abs: string): Promise<string> {
	let existing = abs;
	const missing: string[] = [];
	for (;;) {
		try {
			const real = await fsp.realpath(existing);
			return missing.length === 0 ? real : path.join(real, ...missing);
		} catch {
			const parent = path.dirname(existing);
			if (parent === existing) return abs;
			missing.unshift(path.basename(existing));
			existing = parent;
		}
	}
}

/**
 * Owns the mutable set of directories this process serves.
 *
 * This is the one place that answers "is this a servable root?", and (since
 * the move to a single long-lived server whose roots can change at runtime)
 * the one place that owns which directories are currently mounted. `admit`
 * is the stateless check `serve` uses at startup; `add`/`remove` mutate the
 * live set and notify listeners (the dev server, the Vite watcher, the
 * generated app.css) so a running server stays in sync with what it serves.
 * `add`/`remove` run inside a single queue so two concurrent calls can never
 * interleave their read-modify-write of the mounted set.
 */
export class RootsService {
	private mounted: RootInfo[];
	private listeners: RootsListener[] = [];
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly cwd: string,
		private readonly home: string = os.homedir(),
		mounted: string[] = [],
	) {
		this.mounted = computeRootInfos(mounted);
	}

	private enqueue<Result>(task: () => Promise<Result>): Promise<Result> {
		const run = this.queue.then(task, task);
		this.queue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	/**
	 * Resolve `inputs` against the cwd (expanding a leading `~` first): stat
	 * each one, then realpath it. The returned roots are realpaths, deduped —
	 * a symlinked alias of an already-named directory is dropped rather than
	 * served twice, and Vite's `fs.allow` compares real paths anyway.
	 */
	private async resolveInputs(inputs: string[]): Promise<ResolveInputsResult> {
		const resolved = inputs.map((input) => path.resolve(this.cwd, expandHome(input, this.home)));

		const roots: string[] = [];
		const seen = new Set<string>();
		for (const dirAbs of resolved) {
			let stat;
			try {
				stat = await fsp.stat(dirAbs);
			} catch {
				return { kind: "not-found", message: `no such directory: ${dirAbs}` };
			}
			if (!stat.isDirectory()) {
				return { kind: "not-a-directory", message: `not a directory: ${dirAbs}` };
			}

			const real = await fsp.realpath(dirAbs);
			if (seen.has(real)) continue;
			seen.add(real);
			roots.push(real);
		}

		return { kind: "ok", roots };
	}

	/**
	 * Whether `roots` (already resolved, deduped) can be served together:
	 * never `/`, and never one nested inside another — a single `serve` (or
	 * `add`) naming both is a mistake worth telling the user about, since it
	 * would make `resolveRoot`'s first match order-dependent and list the
	 * shared docs twice.
	 */
	private checkSet(roots: string[]): SetConflict | null {
		if (roots.includes("/")) {
			return { kind: "refused", message: "refusing to serve /" };
		}

		for (const outer of roots) {
			for (const inner of roots) {
				if (outer === inner) continue;
				if (isInside(outer, inner)) {
					return {
						kind: "nested",
						message: `${inner} is inside ${outer}; serve only the outer one`,
					};
				}
			}
		}

		return null;
	}

	/**
	 * Resolve `inputs` and decide whether they can be served together, without
	 * touching the mounted set. Used by `serve` at startup. An empty list
	 * admits an empty set of roots — the caller decides what "no roots" means.
	 */
	async admit(inputs: string[]): Promise<AdmitRootsResult> {
		const resolved = await this.resolveInputs(inputs);
		if (resolved.kind !== "ok") return resolved;

		const conflict = this.checkSet(resolved.roots);
		if (conflict) return conflict;

		return { kind: "ok", roots: resolved.roots, rootInfos: computeRootInfos(resolved.roots) };
	}

	/** The currently mounted roots, in mount order. */
	list(): RootInfo[] {
		return [...this.mounted];
	}

	/**
	 * Mount `inputs`, resolving and validating them the same way `admit` does
	 * against the union of the current set and the new ones. A directory
	 * already mounted is silently skipped (not an error): `added` reports only
	 * what's genuinely new, and listeners are notified only when it's
	 * non-empty. A failed add leaves the mounted set unchanged.
	 */
	async add(inputs: string[]): Promise<AddRootsResult> {
		return this.enqueue(async () => {
			const resolved = await this.resolveInputs(inputs);
			if (resolved.kind !== "ok") return resolved;

			const currentDirs = this.mounted.map((info) => info.dir);
			const currentSet = new Set(currentDirs);
			const added = resolved.roots.filter((dir) => !currentSet.has(dir));

			const conflict = this.checkSet([...currentDirs, ...added]);
			if (conflict) return conflict;

			if (added.length === 0) {
				return { kind: "ok", added: [], roots: this.list() };
			}

			this.mounted = computeRootInfos([...currentDirs, ...added]);
			const roots = this.list();
			for (const listener of this.listeners) {
				await listener({ added, removed: [], roots });
			}
			return { kind: "ok", added, roots };
		});
	}

	/**
	 * Unmount `inputs`. Each input is resolved the same way `add` resolves a
	 * new root, except a directory that no longer exists on disk still
	 * resolves — through the realpath of its nearest surviving ancestor, so a
	 * symlinked spelling (`/tmp/x` for `/private/tmp/x`) still lands on the
	 * mounted realpath — and a root can be removed after the directory behind
	 * it was deleted. Any input that isn't
	 * currently mounted fails the whole call with `not-mounted`, leaving the
	 * set unchanged.
	 */
	async remove(inputs: string[]): Promise<RemoveRootsResult> {
		return this.enqueue(async () => {
			const removed: string[] = [];
			const seen = new Set<string>();
			for (const input of inputs) {
				const dirAbs = path.resolve(this.cwd, expandHome(input, this.home));
				const resolvedDir = await realpathThroughMissingTail(dirAbs);
				if (seen.has(resolvedDir)) continue;
				seen.add(resolvedDir);

				const isMounted = this.mounted.some((info) => info.dir === resolvedDir);
				if (!isMounted) {
					return { kind: "not-mounted", message: `not mounted: ${resolvedDir}` };
				}
				removed.push(resolvedDir);
			}

			if (removed.length === 0) {
				return { kind: "ok", removed: [], roots: this.list() };
			}

			const removedSet = new Set(removed);
			this.mounted = computeRootInfos(
				this.mounted.filter((info) => !removedSet.has(info.dir)).map((info) => info.dir),
			);
			const roots = this.list();
			for (const listener of this.listeners) {
				await listener({ added: [], removed, roots });
			}
			return { kind: "ok", removed, roots };
		});
	}

	/** Subscribe to every future add/remove. Returns a function that unsubscribes. */
	onChange(listener: RootsListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((registered) => registered !== listener);
		};
	}
}
