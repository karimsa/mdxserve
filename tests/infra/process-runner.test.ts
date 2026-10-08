import { it, expect } from "vitest";
import os from "node:os";
import { runProcess } from "../../src/infra/process-runner.js";
it("passes user input on stdin without interpreting it as shell", async () => {
	const content = '$(touch forbidden) `echo nope` ; "literal"';
	const result = await runProcess(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
		cwd: os.tmpdir(),
		signal: new AbortController().signal,
		timeoutMs: 2000,
		input: content,
	});
	expect(result).toEqual({ code: 0, stdout: content });
});
it("terminates a cancelled process", async () => {
	const abort = new AbortController();
	const pending = runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
		cwd: os.tmpdir(),
		signal: abort.signal,
		timeoutMs: 2000,
	});
	abort.abort();
	await expect(pending).rejects.toThrow("cancelled");
});
it("enforces time and output bounds", async () => {
	await expect(
		runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
			cwd: os.tmpdir(),
			signal: new AbortController().signal,
			timeoutMs: 20,
		}),
	).rejects.toThrow("timed out");
	await expect(
		runProcess(process.execPath, ["-e", 'console.log("a".repeat(5000))'], {
			cwd: os.tmpdir(),
			signal: new AbortController().signal,
			timeoutMs: 2000,
			maxBytes: 100,
		}),
	).rejects.toThrow("limit");
});
it("keeps stdin open for a protocol exchange and stops after the response", async () => {
	const received: string[] = [];
	const result = await runProcess(
		process.execPath,
		[
			"-e",
			'process.stdin.on("data", data => { if(data.toString().trim()==="hello") console.log("ready"); else console.log("done"); });',
		],
		{
			cwd: os.tmpdir(),
			signal: new AbortController().signal,
			timeoutMs: 2000,
			input: "hello\n",
			onLine(line) {
				received.push(line);
				return line === "ready" ? { write: "next\n" } : { done: true };
			},
		},
	);
	expect(received).toEqual(["ready", "done"]);
	expect(result.code).toBe(0);
});
