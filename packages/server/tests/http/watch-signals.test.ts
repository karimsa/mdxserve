import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	isWatchIgnored,
	SIGNAL_DEBOUNCE_MS,
	signalFileChanges,
	type FileWatcher,
} from "../../src/http/watch-signals.js";

type Event = Parameters<FileWatcher["on"]>[0];

function setup() {
	const listeners = new Map<Event, Array<(changedPath: string) => void>>();
	const watcher: FileWatcher = {
		on(event, listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), listener]);
		},
	};
	const realtime = { docChanged: vi.fn(), listingChanged: vi.fn() };
	const stop = signalFileChanges(watcher, () => [{ name: "docs", dir: "/r" }], realtime);
	const fire = (event: Event, changedPath: string) => {
		for (const listener of listeners.get(event) ?? []) listener(changedPath);
	};
	return { realtime, stop, fire };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("signalFileChanges", () => {
	it("signals each changed doc's room once per burst", () => {
		const { realtime, fire } = setup();
		fire("change", "/r/a.md");
		fire("change", "/r/a.md");
		fire("change", "/r/sub/b.mdx");
		expect(realtime.docChanged).not.toHaveBeenCalled();
		vi.advanceTimersByTime(SIGNAL_DEBOUNCE_MS);
		expect(realtime.docChanged.mock.calls).toEqual([["/r/a.md"], ["/r/sub/b.mdx"]]);
	});

	it("ignores changes outside the roots, to hidden paths, and to non-docs", () => {
		const { realtime, fire } = setup();
		fire("change", "/elsewhere/a.md");
		fire("change", "/r/.hidden/a.md");
		fire("change", "/r/image.png");
		fire("add", "/elsewhere/a.md");
		fire("add", "/r/.hidden");
		vi.advanceTimersByTime(SIGNAL_DEBOUNCE_MS);
		expect(realtime.docChanged).not.toHaveBeenCalled();
		expect(realtime.listingChanged).not.toHaveBeenCalled();
	});

	it("signals one listing change for a burst of adds and removals", () => {
		const { realtime, fire } = setup();
		fire("add", "/r/a.md");
		fire("unlink", "/r/b.md");
		fire("addDir", "/r/sub");
		fire("unlinkDir", "/r/old");
		vi.advanceTimersByTime(SIGNAL_DEBOUNCE_MS);
		expect(realtime.listingChanged).toHaveBeenCalledTimes(1);
		fire("add", "/r/c.md");
		vi.advanceTimersByTime(SIGNAL_DEBOUNCE_MS);
		expect(realtime.listingChanged).toHaveBeenCalledTimes(2);
	});

	it("drops pending signals when stopped", () => {
		const { realtime, stop, fire } = setup();
		fire("change", "/r/a.md");
		fire("add", "/r/b.md");
		stop();
		vi.advanceTimersByTime(SIGNAL_DEBOUNCE_MS);
		expect(realtime.docChanged).not.toHaveBeenCalled();
		expect(realtime.listingChanged).not.toHaveBeenCalled();
	});
});

describe("isWatchIgnored", () => {
	const roots = [{ name: "docs", dir: "/work/build/docs" }];

	it("skips hidden, dependency, build and git trees below a root, and save temp files", () => {
		for (const ignored of [
			"/work/build/docs/node_modules",
			"/work/build/docs/a/node_modules/pkg/index.js",
			"/work/build/docs/.git/HEAD",
			"/work/build/docs/site/dist/app.js",
			"/work/build/docs/.venv/bin/python",
			"/work/build/docs/.guide.md.mdxserve-tmp",
			"/work/build/docs/.github/logo.png",
			"/work/build/docs/.claude/worktrees/agent-1/README.md",
			"/work/build/docs/.claude/worktrees/agent-1/guide.mdx",
			"/work/build/docs/notes/.draft.md",
		]) {
			expect(isWatchIgnored(roots, ignored)).toBe(true);
		}
	});

	it("watches the root itself and its documents, even under a folder named like an ignored one", () => {
		for (const watched of [
			"/work/build/docs",
			"/work/build/docs/guide.md",
			"/work/build/docs/img/shot.png",
			"/elsewhere/node_modules",
		]) {
			expect(isWatchIgnored(roots, watched)).toBe(false);
		}
	});

	it("watches a root that itself sits in a hidden folder", () => {
		const hiddenRoots = [{ name: "plans", dir: "/home/.codex/plans" }];
		expect(isWatchIgnored(hiddenRoots, "/home/.codex/plans")).toBe(false);
		expect(isWatchIgnored(hiddenRoots, "/home/.codex/plans/a.md")).toBe(false);
		expect(isWatchIgnored(hiddenRoots, "/home/.codex/plans/.cache/a.md")).toBe(true);
	});
});
