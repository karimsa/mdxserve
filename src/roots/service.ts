import fsp from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import { ensureConfig, readConfig, writeConfig, type ConfigSnapshot } from "./config.js";
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

export type ConfigError = { kind: "config-error"; message: string };

export type AddRootsResult =
	| ConfigError
	| { kind: "ok"; added: string[]; roots: RootInfo[] }
	| { kind: "not-found"; message: string }
	| { kind: "not-a-directory"; message: string }
	| { kind: "refused"; message: string }
	| { kind: "nested"; message: string };

export type RemoveRootsResult =
	| ConfigError
	| { kind: "ok"; removed: string[]; roots: RootInfo[] }
	| { kind: "not-mounted"; message: string };

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
 * configuration (when configured), update the live set and notify listeners (the dev server, the Vite watcher, the
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
		private readonly configPath?: string,
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

			let snapshot: ConfigSnapshot | undefined;
			let currentDirs = this.mounted.map((info) => info.dir);
			try {
				if (this.configPath) {
					snapshot = readConfig(this.configPath);
					const admitted = await this.admit(this.configInputs(snapshot));
					if (admitted.kind !== "ok") return this.configError(admitted.message);
					currentDirs = admitted.roots;
				}
			} catch (error) {
				return this.configError(error);
			}

			const currentSet = new Set(currentDirs);
			const added = resolved.roots.filter((dir) => !currentSet.has(dir));

			const conflict = this.checkSet([...currentDirs, ...added]);
			if (conflict) return conflict;

			try {
				if (this.configPath && snapshot && added.length > 0)
					writeConfig(this.configPath, snapshot, [...currentDirs, ...added]);
			} catch (error) {
				return this.configError(error);
			}
			await this.apply([...currentDirs, ...added]);
			const roots = this.list();
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
			let snapshot: ConfigSnapshot | undefined;
			let currentDirs = this.mounted.map((info) => info.dir);
			try {
				if (this.configPath) {
					snapshot = readConfig(this.configPath);
					currentDirs = await Promise.all(
						this.configInputs(snapshot).map(realpathThroughMissingTail),
					);
				}
			} catch (error) {
				return this.configError(error);
			}
			const removed: string[] = [];
			const seen = new Set<string>();
			for (const input of inputs) {
				const dirAbs = path.resolve(this.cwd, expandHome(input, this.home));
				const resolvedDir = await realpathThroughMissingTail(dirAbs);
				if (seen.has(resolvedDir)) continue;
				seen.add(resolvedDir);

				const isMounted = currentDirs.includes(resolvedDir);
				if (!isMounted) {
					return { kind: "not-mounted", message: `not mounted: ${resolvedDir}` };
				}
				removed.push(resolvedDir);
			}

			let remaining = currentDirs.filter((dir) => !seen.has(dir));
			if (this.configPath && snapshot) {
				const admitted = await this.admit(remaining);
				if (admitted.kind !== "ok") return this.configError(admitted.message);
				remaining = admitted.roots;
				try {
					writeConfig(this.configPath, snapshot, admitted.roots);
				} catch (error) {
					return this.configError(error);
				}
			}
			await this.apply(remaining);
			const roots = this.list();
			return { kind: "ok", removed, roots };
		});
	}

	private configError(error: unknown): ConfigError {
		return {
			kind: "config-error",
			message: `${this.configPath}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	private configInputs(snapshot: ConfigSnapshot): string[] {
		return snapshot.value.roots.map((input) =>
			path.resolve(path.dirname(this.configPath!), expandHome(input, this.home)),
		);
	}

	private async apply(dirs: string[]): Promise<void> {
		const previous = this.mounted.map((info) => info.dir);
		if (JSON.stringify(previous) === JSON.stringify(dirs)) return;
		this.mounted = computeRootInfos(dirs);
		const change = {
			added: dirs.filter((dir) => !previous.includes(dir)),
			removed: previous.filter((dir) => !dirs.includes(dir)),
			roots: this.list(),
		};
		for (const listener of this.listeners) await listener(change);
	}

	/** Initialize only at startup; a deleted config during runtime is an error, not an empty set. */
	async initialize(inputs: string[]): Promise<AddRootsResult> {
		try {
			if (this.configPath) ensureConfig(this.configPath);
		} catch (error) {
			return this.configError(error);
		}
		return this.add(inputs);
	}

	async reload(): Promise<{ kind: "ok" } | ConfigError> {
		return this.enqueue(async () => {
			if (!this.configPath) return { kind: "ok" };
			try {
				const snapshot = readConfig(this.configPath);
				const admitted = await this.admit(this.configInputs(snapshot));
				if (admitted.kind !== "ok") return this.configError(admitted.message);
				await this.apply(admitted.roots);
				return { kind: "ok" };
			} catch (error) {
				return this.configError(error);
			}
		});
	}

	/** Poll the path so atomic editor replacements and deletion/recreation remain observable. */
	watchConfig(onError: (message: string) => void): () => void {
		if (!this.configPath) return () => {};
		let closed = false;
		const reload = () => {
			if (closed) return;
			void this.reload().then((result) => {
				if (!closed && result.kind !== "ok") onError(result.message);
			});
		};
		watchFile(this.configPath, { interval: 250, persistent: false }, reload);
		reload();
		return () => {
			closed = true;
			unwatchFile(this.configPath!, reload);
		};
	}

	/** Subscribe to every future add/remove. Returns a function that unsubscribes. */
	onChange(listener: RootsListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((registered) => registered !== listener);
		};
	}
}
