/** The parts of the chokidar watcher `startServer` creates that its error handling uses. */
export interface ClosableWatcher {
	on(event: "error", listener: (error: unknown) => void): unknown;
	close(): Promise<void>;
}

/**
 * Which operating system limit `error` reports the watcher ran into: open file
 * handles, for this process (`EMFILE`) or the whole system (`ENFILE`), or file
 * watches (`ENOSPC`, Linux's inotify limit). Undefined for any other error.
 */
function watchLimitOf(error: unknown): "handles" | "watches" | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	if (error.code === "EMFILE" || error.code === "ENFILE") return "handles";
	if (error.code === "ENOSPC") return "watches";
	return undefined;
}

const OUT_OF_HANDLES =
	"mdxserve: the file watcher ran out of open file handles, so it has stopped. " +
	"Live updates are off until the server restarts: pages still load and save, but open pages " +
	"no longer refresh when files change on disk. Serve a smaller folder or raise the open file " +
	"limit (ulimit -n), then restart.";

const OUT_OF_WATCHES =
	"mdxserve: the file watcher reached the system limit on file watches. " +
	"Live updates may be incomplete: some files will not refresh open pages when they change. " +
	"Serve a smaller folder or raise fs.inotify.max_user_watches, then restart.";

/**
 * Handle the watcher's `error` events so running out of an operating system
 * limit degrades live updates instead of the whole server. Out of file handles,
 * the watcher is closed: the handles it holds are the ones requests need. Out of
 * watches, it keeps what it already watches. Either way the explanation is
 * printed once, and further errors of that kind are dropped; any other error is
 * logged as it comes. `stopped()` says whether the watcher was closed, so the
 * caller does not add roots to it again.
 */
export function handleWatchErrors(
	watcher: ClosableWatcher,
	log: (message: unknown) => void = console.error,
): { stopped: () => boolean } {
	let stopped = false;
	let warnedWatches = false;
	watcher.on("error", (error) => {
		const limit = watchLimitOf(error);
		if (limit === undefined) {
			if (!stopped) log(error);
			return;
		}
		if (limit === "handles") {
			if (stopped) return;
			stopped = true;
			log(OUT_OF_HANDLES);
			watcher.close().catch((closeError: unknown) => log(closeError));
			return;
		}
		if (warnedWatches || stopped) return;
		warnedWatches = true;
		log(OUT_OF_WATCHES);
	});
	return { stopped: () => stopped };
}
