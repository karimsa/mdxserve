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

export type BlockStateStorage = Pick<Storage, "getItem" | "setItem">;

/** Tuple encoding prevents separators inside paths or IDs from creating collisions. */
export function blockStateKey(scope: BlockStateScope): string {
	return `mdxserve:block:${JSON.stringify([scope.version, scope.kind, scope.documentPath, scope.blockId])}`;
}

export function browserBlockStorage(): BlockStateStorage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}

export function serializeBlockState<State>(state: State): string | undefined {
	try {
		return JSON.stringify(state);
	} catch {
		return undefined;
	}
}

/** Legacy keys are consulted only when the current key is absent. */
export function restoreBlockState<State>(
	storage: BlockStateStorage | undefined,
	scope: BlockStateScope,
	schema: BlockStateSchema<State>,
	legacyKeys: readonly string[] = [],
): State | undefined {
	if (!storage) return undefined;

	try {
		for (const key of [blockStateKey(scope), ...legacyKeys]) {
			const saved = storage.getItem(key);
			if (saved === null) continue;

			const parsed = schema.safeParse(JSON.parse(saved));
			return parsed.success ? parsed.data : undefined;
		}
	} catch {
		// Storage access and untrusted saved data must never prevent rendering a block.
	}

	return undefined;
}

export function saveBlockState<State>(
	storage: BlockStateStorage | undefined,
	scope: BlockStateScope,
	state: State,
): void {
	const serialized = serializeBlockState(state);
	if (!storage || serialized === undefined) return;

	try {
		storage.setItem(blockStateKey(scope), serialized);
	} catch {
		// Disabled storage and quota failures leave the block usable in memory.
	}
}
