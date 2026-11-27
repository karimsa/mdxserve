import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyValueStorage } from "../servers/storage";

/** A choice the reader makes once and the device keeps: a value, and how saving it went. */
export interface StoredChoice<Value> {
	value: Value;
	/** Takes effect at once and is saved on the device. */
	set(next: Value): void;
	/** True while a choice is being written. */
	saving: boolean;
	/** Why the last choice could not be saved, until a later one is. */
	problem: string | undefined;
}

/**
 * A setting kept in `storage` under `key`, read once and saved after every change. Writes run
 * one at a time and each writes the latest choice. A write that fails puts the value back to
 * the one last saved only when no choice at all came after it (counted, not compared, since
 * the same value can be chosen again), and says why in `problem`. A choice made before the
 * stored one is read wins over it. `parse` turns the stored text into a value, or undefined
 * when it is not one; `format` turns a value into text.
 */
export function useStoredChoice<Value>({
	storage,
	key,
	fallback,
	parse,
	format,
	describe,
}: {
	storage: KeyValueStorage;
	key: string;
	fallback: Value;
	parse: (stored: string) => Value | undefined;
	format: (value: Value) => string;
	/** What the choice is, for the failure message: "the sort order". */
	describe: string;
}): StoredChoice<Value> {
	const [value, setValue] = useState<Value>(fallback);
	const [pendingWrites, setPendingWrites] = useState(0);
	const [problem, setProblem] = useState<string | undefined>();
	const saved = useRef<Value>(fallback);
	const latest = useRef<Value>(fallback);
	const changed = useRef(false);
	const revision = useRef(0);
	const writing = useRef<Promise<void>>(Promise.resolve());
	// The latest helpers, so a caller may pass new function objects on every render.
	const helpers = useRef({ parse, format, describe });
	helpers.current = { parse, format, describe };

	useEffect(() => {
		let cancelled = false;
		void storage
			.getItem(key)
			.catch(() => null)
			.then((stored) => {
				const parsed = stored === null ? undefined : helpers.current.parse(stored);
				if (cancelled || changed.current || parsed === undefined) return;
				saved.current = parsed;
				latest.current = parsed;
				setValue(parsed);
			});
		return () => {
			cancelled = true;
		};
	}, [storage, key]);

	const set = useCallback(
		(next: Value) => {
			changed.current = true;
			revision.current += 1;
			latest.current = next;
			setValue(next);
			setPendingWrites((count) => count + 1);
			writing.current = writing.current.then(() => {
				const written = latest.current;
				const writtenRevision = revision.current;
				return storage
					.setItem(key, helpers.current.format(written))
					.then(
						() => {
							saved.current = written;
							setProblem(undefined);
						},
						(error: unknown) => {
							if (revision.current === writtenRevision) {
								latest.current = saved.current;
								setValue(saved.current);
							}
							setProblem(
								`${helpers.current.describe[0].toUpperCase()}${helpers.current.describe.slice(1)} was not saved on this device: ${String(error)}`,
							);
						},
					)
					.finally(() => setPendingWrites((count) => count - 1));
			});
		},
		[storage, key],
	);

	return useMemo(
		() => ({ value, set, saving: pendingWrites > 0, problem }),
		[value, set, pendingWrites, problem],
	);
}
