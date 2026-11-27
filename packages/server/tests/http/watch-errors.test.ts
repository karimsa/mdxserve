import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { handleWatchErrors } from "../../src/http/watch-errors.js";

function errnoError(code: string): NodeJS.ErrnoException {
	return Object.assign(new Error(`${code}: watch '/r/a.md'`), { code });
}

function setup() {
	const emitter = new EventEmitter();
	const close = vi.fn(async () => {});
	const watcher = { on: emitter.on.bind(emitter), close };
	const log = vi.fn();
	const handled = handleWatchErrors(watcher, log);
	const fail = (error: unknown) => emitter.emit("error", error);
	return { close, log, handled, fail };
}

describe("handleWatchErrors", () => {
	it("closes the watcher and explains once when it runs out of file handles", () => {
		const { close, log, handled, fail } = setup();
		expect(handled.stopped()).toBe(false);
		for (let attempt = 0; attempt < 50; attempt++) fail(errnoError("EMFILE"));
		fail(errnoError("ENFILE"));
		fail(errnoError("EACCES"));
		expect(close).toHaveBeenCalledTimes(1);
		expect(handled.stopped()).toBe(true);
		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0]![0]).toMatch(/ran out of open file handles/);
		expect(log.mock.calls[0]![0]).toMatch(/Live updates are off until the server restarts/);
	});

	it("keeps watching and explains once when it runs out of watches", () => {
		const { close, log, handled, fail } = setup();
		for (let attempt = 0; attempt < 50; attempt++) fail(errnoError("ENOSPC"));
		expect(close).not.toHaveBeenCalled();
		expect(handled.stopped()).toBe(false);
		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0]![0]).toMatch(/Live updates may be incomplete/);
	});

	it("treats a system-wide shortage of file handles like its own", () => {
		const { close, log, handled, fail } = setup();
		fail(errnoError("ENFILE"));
		expect(close).toHaveBeenCalledTimes(1);
		expect(handled.stopped()).toBe(true);
		expect(log).toHaveBeenCalledTimes(1);
	});

	it("logs any other error as it comes", () => {
		const { close, log, handled, fail } = setup();
		const errors = [errnoError("EACCES"), new Error("boom"), "EMFILE", null];
		for (const error of errors) fail(error);
		expect(log.mock.calls).toEqual(errors.map((error) => [error]));
		expect(close).not.toHaveBeenCalled();
		expect(handled.stopped()).toBe(false);
	});

	it("logs a failure to close instead of throwing it", async () => {
		const emitter = new EventEmitter();
		const closeError = new Error("close failed");
		const log = vi.fn();
		handleWatchErrors(
			{ on: emitter.on.bind(emitter), close: () => Promise.reject(closeError) },
			log,
		);
		emitter.emit("error", errnoError("EMFILE"));
		await vi.waitFor(() => expect(log).toHaveBeenCalledWith(closeError));
	});
});
