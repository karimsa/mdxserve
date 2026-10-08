import { beforeEach, expect, it, vi } from "vitest";
import { listAgentModels } from "../../src/diagrams/adapters/models.js";
import type { ProcessOptions } from "../../src/infra/process-runner.js";
const processMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/infra/process-runner.js", () => ({ runProcess: processMock }));
beforeEach(() => {
	processMock.mockReset();
});
it("initializes Codex before listing all model pages without starting a thread", async () => {
	processMock.mockImplementation(async (_command, _args, options: ProcessOptions) => {
		expect(JSON.parse(options.input!).method).toBe("initialize");
		const actions = options.onLine!(JSON.stringify({ id: "init", result: {} }));
		expect(actions?.write).toContain('"method":"model/list"');
		const next = options.onLine!(
			JSON.stringify({
				id: "models",
				result: {
					data: [
						{ model: "first", displayName: "First" },
						{ model: "hidden", displayName: "Hidden", hidden: true },
					],
					nextCursor: "page2",
				},
			}),
		);
		expect(next?.write).toContain('"cursor":"page2"');
		expect(
			options.onLine!(
				JSON.stringify({
					id: "models",
					result: { data: [{ model: "second", displayName: "Second" }], nextCursor: null },
				}),
			),
		).toEqual({ done: true });
		return { code: 0, stdout: "" };
	});
	expect(await listAgentModels("codex")).toEqual([
		{ id: "first", label: "First" },
		{ id: "second", label: "Second" },
	]);
});
it("reads Claude initialization metadata without sending a user prompt", async () => {
	processMock.mockImplementation(async (_command, args, options: ProcessOptions) => {
		expect(args).toContain("--disable-slash-commands");
		expect(JSON.parse(options.input!)).toEqual({
			type: "control_request",
			request_id: "models",
			request: { subtype: "initialize" },
		});
		options.onLine!(
			JSON.stringify({
				type: "control_response",
				response: {
					subtype: "success",
					request_id: "models",
					response: {
						models: [{ value: "haiku", displayName: "Haiku" }],
						account: { private: "not returned" },
					},
				},
			}),
		);
		return { code: 0, stdout: "" };
	});
	expect(await listAgentModels("claude")).toEqual([{ id: "haiku", label: "Haiku" }]);
});
it("rejects an incomplete catalog rather than inventing available models", async () => {
	processMock.mockResolvedValue({ code: 0, stdout: "" });
	await expect(listAgentModels("codex")).rejects.toThrow("Could not load");
});
