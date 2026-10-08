import { $, which } from "zx";

export interface CommandResult {
	code: number;
	stderr: string;
}

export interface CommandRunner {
	which(name: string): Promise<string | undefined>;
	/** Never throws on a non-zero exit. `inherit` streams the child's output to the terminal. */
	run(command: string, args: string[], options: { inherit: boolean }): Promise<CommandResult>;
}

/** The only place under `src/` that spawns a process. */
export function zxCommandRunner(): CommandRunner {
	return {
		async which(name) {
			const found = await which(name, { nothrow: true });
			return found ?? undefined;
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
