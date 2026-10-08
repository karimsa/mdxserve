import fs from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { localAgentPort } from "../../src/diagrams/adapters/agents.js";
import { draft } from "./fixture.js";
const processMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/infra/process-runner.js", () => ({ runProcess: processMock }));
beforeEach(() => processMock.mockReset());
it("uses Claude's noninteractive streaming image protocol and cleans temporary data", async () => {
	processMock.mockResolvedValue({
		code: 0,
		stdout:
			JSON.stringify({ type: "system" }) +
			"\n" +
			JSON.stringify({ type: "result", is_error: false, structured_output: draft }),
	});
	expect(
		await localAgentPort().convert(
			"claude",
			{ model: "custom-model", text: "literal `user input`", image: Buffer.from("png") },
			new AbortController().signal,
		),
	).toEqual(draft);
	const [command, args, options] = processMock.mock.calls[0];
	expect(command).toBe("claude");
	expect(args[args.indexOf("--model") + 1]).toBe("custom-model");
	expect(args).toEqual(
		expect.arrayContaining([
			"-p",
			"--no-session-persistence",
			"--strict-mcp-config",
			"--disable-slash-commands",
		]),
	);
	expect(args[args.indexOf("--tools") + 1]).toBe("");
	expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
	expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
	const input = JSON.parse(options.input);
	expect(input.message.content[1].source).toEqual({
		type: "base64",
		media_type: "image/png",
		data: Buffer.from("png").toString("base64"),
	});
	expect(fs.existsSync(options.cwd)).toBe(false);
});
it("reports a rejected Claude token without exposing the raw response or switching agents", async () => {
	processMock.mockResolvedValue({
		code: 1,
		stdout: JSON.stringify({
			type: "result",
			is_error: true,
			result: "401 OAuth access token is invalid secret",
		}),
	});
	await expect(
		localAgentPort().convert(
			"claude",
			{ model: "custom-model", text: "orders" },
			new AbortController().signal,
		),
	).rejects.toThrow("sign-in has expired");
	expect(processMock).toHaveBeenCalledTimes(1);
	expect(fs.existsSync(processMock.mock.calls[0][2].cwd)).toBe(false);
});
it("uses Codex structured output, no approvals, and stdin data", async () => {
	processMock.mockResolvedValue({
		code: 0,
		stdout: JSON.stringify({
			type: "item.completed",
			item: { type: "agent_message", text: JSON.stringify(draft) },
		}),
	});
	expect(
		await localAgentPort().convert(
			"codex",
			{ model: "custom-model", text: "customers" },
			new AbortController().signal,
		),
	).toEqual(draft);
	const [, args, options] = processMock.mock.calls[0];
	expect(args[args.indexOf("--model") + 1]).toBe("custom-model");
	expect(args).toEqual(
		expect.arrayContaining([
			"exec",
			"--ephemeral",
			"--ignore-user-config",
			"--ignore-rules",
			'approval_policy="never"',
			"features.shell_tool=false",
			"--output-schema",
		]),
	);
	expect(args.slice(-2)).toEqual(["--", "-"]);
	expect(options.input).toContain('"customers"');
	expect(fs.existsSync(options.cwd)).toBe(false);
});
