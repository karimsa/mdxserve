import path from "node:path";
import { resolveRoot } from "../roots/paths.js";
import { isServable } from "../roots/servable.js";
import type { RootInfo } from "../roots/root-info.js";
import type { Realtime } from "../realtime/server.js";
import { describeDocChange } from "./doc-change.js";

/** The events of a chokidar watcher (Vite's `server.watcher`) that turn into signals. */
export interface FileWatcher {
	on(
		event: "add" | "unlink" | "addDir" | "unlinkDir" | "change",
		listener: (changedPath: string) => void,
	): unknown;
}

/** Waits after the first event of a burst before signalling, so a bulk op fires once. */
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
