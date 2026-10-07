export interface CommandOutcome {
	exitCode: 0 | 1;
	stdout: string[];
	stderr: string[];
}

export function ok(stdout: string[]): CommandOutcome {
	return { exitCode: 0, stdout, stderr: [] };
}

export function fail(message: string): CommandOutcome {
	return { exitCode: 1, stdout: [], stderr: [`mdxserve: ${message}`] };
}

export function printOutcome(outcome: CommandOutcome): void {
	for (const line of outcome.stdout) console.log(line);
	for (const line of outcome.stderr) console.error(line);
	if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
}
