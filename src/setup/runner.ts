export { zxCommandRunner } from "../infra/process-runner.js";
export interface CommandResult {
	code: number;
	stderr: string;
}

export interface CommandRunner {
	which(name: string): Promise<string | undefined>;
	/** Never throws on a non-zero exit. `inherit` streams the child's output to the terminal. */
	run(command: string, args: string[], options: { inherit: boolean }): Promise<CommandResult>;
}
