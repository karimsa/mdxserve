import type { BlockStateStorage } from "./storage";

/**
 * `localStorage`, read on each call: a sandboxed frame or a browser with storage turned off
 * throws on access, which the storage helpers treat as no saved state.
 */
export const defaultBlockStorage: BlockStateStorage | undefined = {
	getItem: (key) => window.localStorage.getItem(key),
	setItem: (key, value) => window.localStorage.setItem(key, value),
};

/** Outside a document, a block's state is kept per page. */
export function pagePath(): string {
	return typeof location === "undefined" ? "" : location.pathname;
}
