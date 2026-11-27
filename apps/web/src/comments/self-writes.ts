/**
 * Paths this tab just wrote comments to. The "Reloaded" toast consults it so the
 * author's own comment write does not announce a reload. Imports nothing, so
 * Toast.tsx and the comment code can share it without a cycle.
 * @internal Exported for its tests.
 */
export const SELF_WRITE_WINDOW_MS = 2000;

const writes = new Map<string, number>();

export function markSelfWrite(path: string, now: number = Date.now()): void {
	writes.set(path, now + SELF_WRITE_WINDOW_MS);
}

export function isSelfWrite(path: string, now: number = Date.now()): boolean {
	const until = writes.get(path);
	if (until === undefined) return false;
	if (now >= until) {
		writes.delete(path);
		return false;
	}
	return true;
}
