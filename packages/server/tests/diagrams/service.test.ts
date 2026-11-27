import { describe, it, expect, vi } from "vitest";
import { fixture, draft, input } from "./fixture.js";
describe("DiagramsService", () => {
	it("rejects remote and disabled calls without probing", async () => {
		const test = fixture();
		try {
			expect((await test.service.convert(input, false)).kind).toBe("forbidden");
			test.preferences.set("disabled");
			expect((await test.service.convert(input, true)).kind).toBe("disabled");
			expect(test.port.probe).not.toHaveBeenCalled();
		} finally {
			test.cleanup();
		}
	});
	it("honors explicit preference without fallback", async () => {
		const test = fixture();
		try {
			test.preferences.set("claude", { codex: "gpt-6-luna", claude: "custom-claude" });
			const result = await test.service.convert(input, true);
			expect(result).toMatchObject({ kind: "ok", value: { provider: "claude" } });
			expect(test.port.probe).not.toHaveBeenCalled();
			expect(test.port.convert).toHaveBeenCalledWith(
				"claude",
				expect.objectContaining({ model: "custom-claude" }),
				expect.anything(),
			);
		} finally {
			test.cleanup();
		}
	});
	it("repairs syntax once and rejects a second invalid result", async () => {
		const test = fixture();
		try {
			test.validate.mockResolvedValue("invalid syntax");
			expect((await test.service.convert(input, true)).kind).toBe("error");
			expect(test.port.convert).toHaveBeenCalledTimes(2);
		} finally {
			test.cleanup();
		}
	});
	it("rejects late revisions cancelled before request arrival", async () => {
		const test = fixture();
		try {
			test.service.cancel(input.session, 2, true);
			expect((await test.service.convert(input, true)).kind).toBe("cancelled");
			expect(test.port.convert).not.toHaveBeenCalled();
		} finally {
			test.cleanup();
		}
	});
	it("keeps conversion capacity available after many dialogs close while rejecting late requests", async () => {
		const test = fixture();
		try {
			for (let index = 0; index < 120; index++) {
				const session = `closed-${index}`;
				expect((await test.service.convert({ ...input, session }, true)).kind).toBe("ok");
				expect(test.service.release(session, true).kind).toBe("ok");
			}
			for (const session of ["closed-0", "closed-119"]) {
				expect((await test.service.convert({ ...input, session, revision: 2 }, true)).kind).toBe(
					"cancelled",
				);
				expect(test.service.beginUpload(session, true).kind).toBe("cancelled");
			}
			test.service.cancel("cancel-before-arrival", 2, true);
			expect(
				(await test.service.convert({ ...input, session: "cancel-before-arrival" }, true)).kind,
			).toBe("cancelled");
			expect((await test.service.convert(input, true)).kind).toBe("ok");
			expect(test.port.convert).toHaveBeenCalledTimes(121);
		} finally {
			test.cleanup();
		}
	});
	it("still bounds unreleased sessions and frees capacity when one closes", async () => {
		const test = fixture();
		try {
			for (let index = 0; index < 100; index++)
				expect(
					(await test.service.convert({ ...input, session: `open-${index}` }, true)).kind,
				).toBe("ok");
			expect((await test.service.convert(input, true)).kind).toBe("busy");
			test.service.release("open-0", true);
			expect((await test.service.convert(input, true)).kind).toBe("ok");
			expect(
				(await test.service.convert({ ...input, session: "open-0", revision: 2 }, true)).kind,
			).toBe("cancelled");
		} finally {
			test.cleanup();
		}
	});
	it("kills superseded work and serializes replacement", async () => {
		let started: () => void = () => {};
		const began = new Promise<void>((resolve) => (started = resolve));
		let calls = 0;
		const test = fixture({
			models: async () => [],
			probe: async () => [{ provider: "codex", state: "ready" }],
			convert: async (_, __, signal) => {
				calls++;
				if (calls === 1) {
					started();
					await new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => resolve(), { once: true }),
					);
				}
				return draft;
			},
		});
		try {
			const first = test.service.convert(input, true);
			await began;
			const second = test.service.convert({ ...input, revision: 2 }, true);
			expect((await first).kind).toBe("cancelled");
			expect((await second).kind).toBe("ok");
		} finally {
			test.cleanup();
		}
	});
	it("enforces image ordering, ownership and bounds", async () => {
		const test = fixture();
		try {
			const upload = test.service.beginUpload(input.session, true);
			if (upload.kind !== "ok") throw new Error("upload");
			expect(test.service.appendUpload("other", upload.value, 0, "YQ==", true).kind).toBe("error");
			expect(test.service.appendUpload(input.session, upload.value, 1, "YQ==", true).kind).toBe(
				"error",
			);
			expect(test.service.appendUpload(input.session, upload.value, 0, "YQ==", true)).toEqual({
				kind: "ok",
				value: 1,
			});
			expect((await test.service.finishUpload(input.session, upload.value, true)).kind).toBe("ok");
			test.service.release(input.session, true);
			expect((await test.service.finishUpload(input.session, upload.value, true)).kind).toBe(
				"error",
			);
		} finally {
			test.cleanup();
		}
	});
	it("disabling aborts work without accepting the result", async () => {
		let started: () => void = () => {};
		const began = new Promise<void>((resolve) => (started = resolve));
		const convert = vi.fn(async (_, __, signal: AbortSignal) => {
			started();
			await new Promise<void>((resolve) =>
				signal.addEventListener("abort", () => resolve(), { once: true }),
			);
			return draft;
		});
		const test = fixture({
			models: async () => [],
			probe: async () => [{ provider: "codex", state: "ready" }],
			convert,
		});
		try {
			const pending = test.service.convert(input, true);
			await began;
			test.service.setPreferences("disabled", true);
			expect((await pending).kind).toBe("cancelled");
		} finally {
			test.cleanup();
		}
	});
});

it("detects only on explicit request, including while disabled", async () => {
	const test = fixture();
	try {
		test.preferences.set("disabled");
		test.service.getPreferences(true);
		expect(test.port.probe).not.toHaveBeenCalled();
		expect((await test.service.probe(true)).kind).toBe("ok");
		expect(test.port.probe).toHaveBeenCalledTimes(1);
		expect(test.port.convert).not.toHaveBeenCalled();
	} finally {
		test.cleanup();
	}
});
it("passes the configured model through syntax repair without probing or switching", async () => {
	const test = fixture();
	try {
		test.preferences.set("codex", { codex: "custom-codex", claude: "haiku" });
		test.validate.mockResolvedValueOnce("syntax error");
		expect((await test.service.convert(input, true)).kind).toBe("ok");
		expect(test.port.convert).toHaveBeenCalledTimes(2);
		expect(test.port.convert).toHaveBeenNthCalledWith(
			1,
			"codex",
			expect.objectContaining({ model: "custom-codex" }),
			expect.anything(),
		);
		expect(test.port.convert).toHaveBeenNthCalledWith(
			2,
			"codex",
			expect.objectContaining({ model: "custom-codex" }),
			expect.anything(),
		);
		expect(test.port.probe).not.toHaveBeenCalled();
	} finally {
		test.cleanup();
	}
});

it("bounds discovery concurrency and aborts discovery on shutdown", async () => {
	let started: () => void = () => {};
	const began = new Promise<void>((resolve) => {
		started = resolve;
	});
	const models = vi.fn(async (_provider, signal?: AbortSignal) => {
		started();
		await new Promise<void>((resolve) =>
			signal!.addEventListener("abort", () => resolve(), { once: true }),
		);
		return [];
	});
	const test = fixture({ models, probe: async () => [], convert: async () => draft });
	try {
		const running = test.service.listModels("codex", true);
		await began;
		test.preferences.set("disabled");
		test.service.stopIfDisabled();
		expect(models.mock.calls[0][1]?.aborted).toBe(false);
		expect((await test.service.listModels("claude", true)).kind).toBe("busy");
		expect((await test.service.probe(true)).kind).toBe("busy");
		expect(models).toHaveBeenCalledTimes(1);
		test.service.dispose();
		await running;
		expect((await test.service.probe(true)).kind).toBe("ok");
	} finally {
		test.cleanup();
	}
});
it("gives queued conversions their execution budget after dequeuing", async () => {
	vi.useFakeTimers();
	const test = fixture();
	const signals: AbortSignal[] = [];
	const finish: Array<() => void> = [];
	test.port.convert = vi.fn(async (_provider, _input, signal) => {
		signals.push(signal);
		await new Promise<void>((resolve) => finish.push(resolve));
		return draft;
	});
	try {
		const first = test.service.convert(input, true);
		await vi.advanceTimersByTimeAsync(0);
		const second = test.service.convert({ ...input, session: "second" }, true);
		await vi.advanceTimersByTimeAsync(70000);
		finish[0]();
		await first;
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(30000);
		expect(signals[1].aborted).toBe(false);
		finish[1]();
		expect((await second).kind).toBe("ok");
	} finally {
		test.service.dispose();
		test.cleanup();
		vi.useRealTimers();
	}
});

it.each([false, true])(
	"admits the newest queued edit with explicit cancellation %s",
	async (cancelFirst) => {
		let started: () => void = () => {};
		const began = new Promise<void>((resolve) => {
			started = resolve;
		});
		let finish: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const test = fixture();
		test.port.convert = vi.fn(async (_provider, request) => {
			if (request.text === "blocking conversion") {
				started();
				await blocked;
			}
			return draft;
		});
		try {
			const first = test.service.convert({ ...input, text: "blocking conversion" }, true);
			await began;
			const others = ["other-1", "other-2"].map((session) =>
				test.service.convert({ ...input, session }, true),
			);
			const revisions = [test.service.convert({ ...input, session: "editing" }, true)];
			expect((await test.service.convert({ ...input, session: "overflow" }, true)).kind).toBe(
				"busy",
			);
			for (let revision = 2; revision <= 10; revision++) {
				if (cancelFirst) test.service.cancel("editing", revision - 1, true);
				revisions.push(
					test.service.convert(
						{ ...input, session: "editing", revision, text: `edit ${revision}` },
						true,
					),
				);
			}
			expect(test.port.convert).toHaveBeenCalledTimes(1);
			finish();
			expect((await first).kind).toBe("ok");
			expect((await Promise.all(others)).map((result) => result.kind)).toEqual(["ok", "ok"]);
			const results = await Promise.all(revisions);
			expect(results.slice(0, -1).every((result) => result.kind === "cancelled")).toBe(true);
			expect(results.at(-1)?.kind).toBe("ok");
			expect(test.port.convert).toHaveBeenCalledTimes(4);
			expect(test.port.convert).toHaveBeenLastCalledWith(
				"codex",
				expect.objectContaining({ text: "edit 10" }),
				expect.anything(),
			);
		} finally {
			finish();
			test.service.dispose();
			test.cleanup();
		}
	},
);
