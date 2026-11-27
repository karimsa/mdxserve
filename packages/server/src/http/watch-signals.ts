import path from "node:path";
import { resolveRoot } from "../roots/paths.js";
import { isServable } from "../roots/servable.js";
import type { RootInfo } from "../roots/root-info.js";
import type { Realtime } from "../realtime/server.js";
import { describeDocChange } from "./doc-change.js";
import { isIgnoredDir } from "../listing/tree.js";

/** The events of the chokidar watcher `startServer` creates that turn into signals. */
export interface FileWatcher {
	on(
		event: "add" | "unlink" | "addDir" | "unlinkDir" | "change",
		listener: (changedPath: string) => void,
	): unknown;
}

/**
 * Whether the watcher skips `changedPath`: anything below a hidden or
 * `node_modules` segment (which the listings, the doc routes and the doc-change
 * signal all refuse, `isServable`), or below a directory the tree also leaves
 * out (build output, virtualenvs; `isIgnoredDir`). A save's temp file is a
 * dotfile, so it is skipped too. Only the part below a root counts, so a root
 * that itself sits under a `build/` or hidden folder is still watched. The
 * mounted set never nests roots, but should two contain the path, it is skipped
 * only when every one of them would skip it, so the answer does not depend on
 * root order. Every skipped path would otherwise hold an open file handle while
 * producing no signal anyone sees.
 */
export function isWatchIgnored(roots: RootInfo[], changedPath: string): boolean {
	const containing = roots.flatMap((info) => resolveRoot([info.dir], changedPath) ?? []);
	if (containing.length === 0) return false;
	return containing.every((hit) =>
		path
			.relative(hit.root, hit.abs)
			.split(path.sep)
			.filter(Boolean)
			.some((segment) => !isServable(segment) || isIgnoredDir(segment)),
	);
}

/**
 * Waits after the first event of a burst before signalling, so a bulk op fires once.
 * @internal Exported for its tests.
 */
export const SIGNAL_DEBOUNCE_MS = 100;

/**
 * Turn file watcher events under the mounted roots into live update signals.
 * A file or folder added or removed signals `listing-changed` to everyone; a
 * doc whose contents changed signals its own room. Each kind is debounced so
 * a bulk op (git checkout, rm -rf dir) or an editor's double-write fires one
 * signal per doc instead of a storm. `roots` is read on every event, so a
 * root mounted later is covered. Returns a function that drops pending signals.
 */
export function signalFileChanges(
	watcher: FileWatcher,
	roots: () => RootInfo[],
	realtime: Pick<Realtime, "docChanged" | "listingChanged">,
): () => void {
	let listingTimer: NodeJS.Timeout | null = null;

	function onListingEvent(changedPath: string): void {
		if (!isServable(path.basename(changedPath))) return;
		const liveRoots = roots().map((info) => info.dir);
		if (!resolveRoot(liveRoots, path.dirname(changedPath))) return;
		if (listingTimer) return;
		listingTimer = setTimeout(() => {
			listingTimer = null;
			realtime.listingChanged();
		}, SIGNAL_DEBOUNCE_MS);
	}

	const changedDocs = new Set<string>();
	let docTimer: NodeJS.Timeout | null = null;

	function onDocChange(changedPath: string): void {
		const change = describeDocChange(roots(), changedPath);
		if (!change) return;
		changedDocs.add(change.path);
		if (docTimer) return;
		docTimer = setTimeout(() => {
			docTimer = null;
			const files = [...changedDocs];
			changedDocs.clear();
			for (const file of files) realtime.docChanged(file);
		}, SIGNAL_DEBOUNCE_MS);
	}

	watcher.on("add", onListingEvent);
	watcher.on("unlink", onListingEvent);
	watcher.on("addDir", onListingEvent);
	watcher.on("unlinkDir", onListingEvent);
	watcher.on("change", onDocChange);

	return () => {
		if (listingTimer) clearTimeout(listingTimer);
		if (docTimer) clearTimeout(docTimer);
		listingTimer = null;
		docTimer = null;
		changedDocs.clear();
	};
}
