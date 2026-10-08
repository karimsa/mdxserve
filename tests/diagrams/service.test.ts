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
