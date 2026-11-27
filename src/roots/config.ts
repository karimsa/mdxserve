import { writeConfig as patchConfig, type ConfigSnapshot } from "../infra/config.js";
export { readConfig, ensureConfig, type ConfigSnapshot } from "../infra/config.js";
export function writeConfig(file: string, snapshot: ConfigSnapshot, roots: string[]): void {
	patchConfig(file, snapshot, { roots });
}
