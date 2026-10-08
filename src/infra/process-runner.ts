import { StringDecoder } from "node:string_decoder";
import { spawn } from "node:child_process";
import { $, which } from "zx";
import type { CommandRunner } from "../setup/runner.js";

/** Setup's legacy runner and non-interactive agents share the process boundary. */
export function zxCommandRunner(): CommandRunner {
	return {
		async which(name) {
			return (await which(name, { nothrow: true })) ?? undefined;
		},
		async run(command, args, options) {
			const output = await $({
				nothrow: true,
				quiet: !options.inherit,
				stdio: options.inherit ? "inherit" : "pipe",
			})`${command} ${args}`;
			return { code: output.exitCode ?? 1, stderr: output.stderr };
		},
	};
}
export interface ProcessOptions {
	cwd: string;
	input?: string;
	signal: AbortSignal;
	timeoutMs: number;
	env?: NodeJS.ProcessEnv;
	maxBytes?: number;
	/** Exchange bounded JSON lines without closing stdin before the response arrives. */
	onLine?: (line: string) => { write?: string; done?: boolean } | undefined;
}
export async function runProcess(
	command: string,
	args: string[],
	options: ProcessOptions,
): Promise<{ code: number; stdout: string }> {
	if (options.signal.aborted) throw new Error("Conversion cancelled");
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["pipe", "pipe", "pipe"],
			detached: process.platform !== "win32",
			windowsHide: true,
			shell: false,
		});
		const output: Buffer[] = [];
		let bytes = 0;
		let buffered = "";
		const decoder = new StringDecoder("utf8");
		let completed = false;
		let failure: Error | undefined;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const terminate = () => {
			try {
				if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
				else child.kill("SIGTERM");
			} catch {}
			killTimer ??= setTimeout(() => {
				try {
					if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
					else child.kill("SIGKILL");
				} catch {}
			}, 500);
		};
		const abort = () => {
			failure = new Error("Conversion cancelled");
			terminate();
		};
		options.signal.addEventListener("abort", abort, { once: true });
		const timeout = setTimeout(() => {
			failure = new Error("Agent timed out; retry or choose another agent");
			terminate();
		}, options.timeoutMs);
		const collect = (chunk: Buffer, retain: boolean) => {
			bytes += chunk.length;
			if (bytes > (options.maxBytes ?? 1024 * 1024)) {
				failure = new Error("Agent output exceeded the limit");
				terminate();
				return;
			}
			if (retain) {
				output.push(chunk);
				if (options.onLine && !completed && !failure) {
					buffered += decoder.write(chunk);
					let boundary: number;
					while ((boundary = buffered.indexOf("\n")) >= 0 && !completed) {
						const line = buffered.slice(0, boundary);
						buffered = buffered.slice(boundary + 1);
						try {
							const action = options.onLine(line);
							if (action?.write) child.stdin.write(action.write);
							if (action?.done) {
								completed = true;
								terminate();
							}
						} catch {
							failure = new Error("Invalid agent protocol response");
							terminate();
							break;
						}
					}
				}
			}
		};
		child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
		child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
		child.stdin.on("error", () => {});
		if (options.onLine) child.stdin.write(options.input ?? "");
		else child.stdin.end(options.input ?? "");
		const cleanup = () => {
			clearTimeout(timeout);
			if (killTimer) {
				clearTimeout(killTimer);
				try {
					if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
				} catch {}
			}
			options.signal.removeEventListener("abort", abort);
		};
		child.on("error", () => {
			cleanup();
			reject(new Error("Agent executable could not be started"));
		});
		child.on("close", (code) => {
			cleanup();
			if (failure) reject(failure);
			else
				resolve({
					code: completed ? 0 : (code ?? 1),
					stdout: Buffer.concat(output).toString("utf8"),
				});
		});
		if (options.signal.aborted) abort();
	});
}
