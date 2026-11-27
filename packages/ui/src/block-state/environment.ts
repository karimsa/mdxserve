import type { BlockStateStorage } from "./storage";

/**
 * The app has no storage of its own to fall back on: it hands one to
 * `BlockStateStorageContext` (apps/mobile/app/_layout.tsx). The web's is `localStorage`
 * (environment.web.ts).
 */
export const defaultBlockStorage: BlockStateStorage | undefined = undefined;

/** A block outside a document has no page of its own in the app. */
export function pagePath(): string {
	return "";
}
