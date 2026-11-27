/** Where the server list is kept: AsyncStorage on the device, memory in tests. */
export interface KeyValueStorage {
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
}

/**
 * Storage that lives as long as the object.
 * @internal Exported for its tests.
 */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
	const values = new Map(Object.entries(initial));
	return {
		getItem: async (key) => values.get(key) ?? null,
		setItem: async (key, value) => {
			values.set(key, value);
		},
	};
}
