import type { CommandRunner } from "../../src/setup/runner.js";

export interface LoggedCall {
	command: string;
	args: string[];
	inherit: boolean;
}

export function fakeRunner(options: {
	available: ReadonlySet<string>;
	exitCodes: (command: string, args: string[]) => number;
}): CommandRunner & { log: LoggedCall[] } {
	const log: LoggedCall[] = [];
	return {
		log,
		async which(name) {
			return options.available.has(name) ? `/usr/bin/${name}` : undefined;
		},
		async run(command, args, runOptions) {
			log.push({ command, args, inherit: runOptions.inherit });
			const code = options.exitCodes(command, args);
			return { code, stderr: code === 0 ? "" : "line1\nboom" };
		},
	};
}
