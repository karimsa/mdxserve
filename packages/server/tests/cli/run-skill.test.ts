import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const skill = fs.readFileSync(path.join(repoRoot, "skills/mdxserve-run/SKILL.md"), "utf8");

/** Every `mdxserve ...` command the skill writes, in a code block or inline code. */
function skillCommands(): string[] {
	const commands = new Set<string>();
	for (const match of skill.matchAll(
		/(?:^|`|"|\n)(mdxserve (?:[a-z][\w-]*|-[\w-]+|<[^>]+>|\[[^\]]+\])(?: (?:[a-z][\w-]*|-[\w-]+|<[^>]+>|\[[^\]]+\]))*)/g,
	)) {
		commands.add(match[1].trim());
	}
	return [...commands];
}

it("K5: every mdxserve command in the run skill exists in the CLI as written", () => {
	const commands = skillCommands();
	expect(commands).toEqual(
		expect.arrayContaining(["mdxserve status", "mdxserve roots add <dir> [<dir>...]"]),
	);
	const helps = new Map<string, string>();
	for (const command of commands) {
		const words = command.split(" ").slice(1);
		const verbs: string[] = [];
		for (const word of words) {
			if (!/^[a-z]/.test(word)) break;
			verbs.push(word);
		}
		const key = verbs.join(" ");
		if (!helps.has(key)) {
			const result = spawnSync(
				process.execPath,
				["--import", "tsx", "src/index.ts", ...verbs, "--help"],
				{ cwd: repoRoot, encoding: "utf8", timeout: 60_000 },
			);
			expect(result.status, command).toBe(0);
			expect(result.stdout, command).toMatch(new RegExp(`^Usage: mdxserve ${key} `, "m"));
			helps.set(key, result.stdout);
		}
		for (const flag of words.filter((word) => word.startsWith("-"))) {
			expect(helps.get(key), `${command}: ${flag}`).toMatch(
				new RegExp(`(^|[ ,])${flag}([ ,]|$)`, "m"),
			);
		}
	}
	// Flags the prose names outside a full command.
	const serveHelp = helps.get("serve") ?? "";
	for (const flag of [
		"-w",
		"-p",
		"--permissions",
		"--host",
		"--dangerous-allow-network",
		"--no-tailscale",
	]) {
		expect(serveHelp, flag).toMatch(new RegExp(`(^|[ ,])${flag}([ ,]|$)`, "m"));
	}
}, 300_000);
