import { pushToast } from "./ui/Toast";

/** A second failure this soon after a reload means reloading does not help. */
const RELOAD_GAP_MS = 30_000;
const RELOADED_AT_KEY = "mdxserve:stale-build-reloaded-at";

type StaleBuildAction = "reload" | "ask";

/**
 * What to do when a chunk of the client fails to load. That happens when the server was
 * updated or rebuilt after this page loaded: the page asks for files of the old build, which
 * the new one does not have. Reloading fetches the new build. It is not done while the page
 * holds unsaved text (`editing`), or a second time within `RELOAD_GAP_MS`, which would loop.
 *
 * @internal Exported for its tests.
 */
export function staleBuildAction(
	editing: boolean,
	reloadedAt: number | null,
	now: number,
): StaleBuildAction {
	if (editing) return "ask";
	if (reloadedAt !== null && now - reloadedAt < RELOAD_GAP_MS) return "ask";
	return "reload";
}

function readReloadedAt(): number | null {
	try {
		const stored = Number.parseInt(sessionStorage.getItem(RELOADED_AT_KEY) ?? "", 10);
		return Number.isFinite(stored) ? stored : null;
	} catch {
		return null;
	}
}

/**
 * Whether the page holds text a reload would lose: an open section editor, an open dialog
 * (the diagram editor), or a text field with something typed in it (a comment draft).
 *
 * @internal Exported for its tests.
 */
export function hasUnsavedInput(root: ParentNode): boolean {
	if (root.querySelector(".ProseMirror, [contenteditable='true'], dialog[open]")) return true;
	return [...root.querySelectorAll("textarea")].some((field) => field.value.trim() !== "");
}

/** Vite dispatches `vite:preloadError` on `window` when a dynamic import fails to load. */
export function installStaleBuildReload(): void {
	const ask = () =>
		pushToast({
			tone: "warn",
			text: "mdxserve was updated. Reload the page to keep going.",
			dedupeKey: "stale-build",
		});
	window.addEventListener("vite:preloadError", () => {
		const now = Date.now();
		if (staleBuildAction(hasUnsavedInput(document), readReloadedAt(), now) === "ask") {
			ask();
			return;
		}
		try {
			sessionStorage.setItem(RELOADED_AT_KEY, String(now));
		} catch {
			// The time of this reload cannot be kept, so nothing would stop the next page from
			// reloading again if the chunk is still missing. Leave the reload to the reader.
			ask();
			return;
		}
		location.reload();
	});
}
