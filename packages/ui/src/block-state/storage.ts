/** Identity of a reusable block within a document. IDs should survive content edits. */
export interface BlockStateScope {
	documentPath: string;
	blockId: string;
	kind: string;
	version: number;
}

export interface BlockStateSchema<State> {
	safeParse(value: unknown): { success: true; data: State } | { success: false };
}

export type MaybePromise<Value> = Value | Promise<Value>;

/**
 * Where reader state is kept. The web's `localStorage` fits as it is; an asynchronous store
 * (the app's AsyncStorage) may return promises instead.
 */
export interface BlockStateStorage {
	getItem(key: string): MaybePromise<string | null>;
	setItem(key: string, value: string): MaybePromise<void>;
}

export function isPromise<Value>(value: MaybePromise<Value>): value is Promise<Value> {
	return typeof (value as { then?: unknown } | null)?.then === "function";
}

/** Tuple encoding prevents separators inside paths or IDs from creating collisions. */
export function blockStateKey(scope: BlockStateScope): string {
	return `mdxserve:block:${JSON.stringify([scope.version, scope.kind, scope.documentPath, scope.blockId])}`;
}

/** Storage that lasts as long as the process: the app's, until it keeps state on the device. */
export function createMemoryBlockStorage(): BlockStateStorage {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
	};
}

export function serializeBlockState<State>(state: State): string | undefined {
	try {
		return JSON.stringify(state);
	} catch {
		return undefined;
	}
}

/**
 * Legacy keys are consulted only when the current key is absent. A storage that answers
 * synchronously gets a synchronous result; one that returns promises gets a promise that never
 * rejects.
 */
export function restoreBlockState<State>(
	storage: BlockStateStorage | undefined,
	scope: BlockStateScope,
	schema: BlockStateSchema<State>,
	legacyKeys: readonly string[] = [],
): MaybePromise<State | undefined> {
	if (!storage) return undefined;

	const keys = [blockStateKey(scope), ...legacyKeys];
	const parse = (saved: string) => {
		const parsed = schema.safeParse(JSON.parse(saved));
		return parsed.success ? parsed.data : undefined;
	};
	const readFrom = (index: number): MaybePromise<State | undefined> => {
		if (index >= keys.length) return undefined;
		const saved = storage.getItem(keys[index]);
		const settle = (value: string | null) => (value === null ? readFrom(index + 1) : parse(value));
		return isPromise(saved) ? saved.then(settle) : settle(saved);
	};

	// Storage access and untrusted saved data must never prevent rendering a block.
	try {
		const restored = readFrom(0);
		return isPromise(restored) ? restored.catch(() => undefined) : restored;
	} catch {
		return undefined;
	}
}

export function saveBlockState<State>(
	storage: BlockStateStorage | undefined,
	scope: BlockStateScope,
	state: State,
): void {
	const serialized = serializeBlockState(state);
	if (!storage || serialized === undefined) return;

	// Disabled storage and quota failures leave the block usable in memory.
	try {
		const saved = storage.setItem(blockStateKey(scope), serialized);
		if (isPromise(saved)) saved.catch(() => undefined);
	} catch {
		// A storage may throw rather than reject; the same applies.
	}
}
