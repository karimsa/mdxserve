import { createContext, useContext } from "react";

/** Puts text on the system clipboard. */
export type CopyText = (text: string) => Promise<void>;

/**
 * The app's clipboard, which needs a native module the package may not import (an Expo
 * module); the app provides it (`expo-clipboard`). Without a provider there is no clipboard,
 * and copy controls hide themselves.
 */
export const ClipboardContext = createContext<CopyText | null>(null);

/** How to copy text here, or null where there is no clipboard. The web's is clipboard.web.tsx. */
export function useCopyText(): CopyText | null {
	return useContext(ClipboardContext);
}
