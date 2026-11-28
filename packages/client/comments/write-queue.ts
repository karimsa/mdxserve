/** Runs tasks one after another per key. */
export interface WriteQueue {
	/**
	 * Runs `task` once every earlier task for `key` has settled, and resolves or rejects as it
	 * does. A task that fails does not stop the ones queued after it.
	 */
	run<Result>(key: string, task: () => Promise<Result>): Promise<Result>;
}

/**
 * A comment write answers with the document's whole thread list. Two writes in flight for one
 * document could land out of order and roll the cached list back, so a document's writes go
 * through one queue, keyed by the document.
 */
export function createWriteQueue(): WriteQueue {
	const tails = new Map<string, Promise<unknown>>();
	return {
		run(key, task) {
			const previous = tails.get(key) ?? Promise.resolve();
			const result = previous.then(task);
			// The chain waits for the task to settle, never for it to succeed.
			const tail = result.then(
				() => undefined,
				() => undefined,
			);
			tails.set(key, tail);
			void tail.then(() => {
				if (tails.get(key) === tail) tails.delete(key);
			});
			return result;
		},
	};
}
