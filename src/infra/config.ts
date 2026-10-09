import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const rootsConfigSchema = z.object({ roots: z.array(z.string().min(1)) }).passthrough();
export type ConfigSnapshot = { content: string; value: z.infer<typeof rootsConfigSchema> };

export function readConfig(file: string): ConfigSnapshot {
	const content = fs.readFileSync(file, "utf8");
	return { content, value: rootsConfigSchema.parse(JSON.parse(content)) };
}

/** Exclusive creation never overwrites an existing user configuration. */
export function ensureConfig(file: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	try {
		fs.writeFileSync(file, `${JSON.stringify({ roots: [] }, null, 2)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}

/** Preserve unrelated settings and detect edits made during asynchronous validation. */
export function writeConfig(
	file: string,
	snapshot: ConfigSnapshot,
	patch: Record<string, unknown>,
): void {
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(temporary, `${JSON.stringify({ ...snapshot.value, ...patch }, null, 2)}\n`, {
			mode: 0o600,
		});
		if (fs.readFileSync(file, "utf8") !== snapshot.content) {
			throw new Error("configuration changed while updating settings; retry");
		}
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}
