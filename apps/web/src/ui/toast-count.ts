/**
 * Advances the repeat-push counter for one dedupe key.
 *
 * `counts` is keyed by dedupe id and tracks how many pushes a still-live
 * toast has absorbed. Before touching `id`, every key no longer present in
 * `live` is dropped — once react-hot-toast has actually removed a toast
 * (auto-dismissed, closed by the reader, or evicted), a later push reusing
 * that id starts a fresh card at count 1 rather than resuming an old count.
 * Then: if `id` is both live and already counted, increment; otherwise this
 * is the first push for that id (or its first push since it went away), so
 * the count resets to 1.
 */
export function nextCount(
	live: ReadonlySet<string>,
	counts: Map<string, number>,
	id: string,
): number {
	for (const key of counts.keys()) {
		if (!live.has(key)) counts.delete(key);
	}
	if (live.has(id) && counts.has(id)) {
		const incremented = counts.get(id)! + 1;
		counts.set(id, incremented);
		return incremented;
	}
	counts.set(id, 1);
	return 1;
}
