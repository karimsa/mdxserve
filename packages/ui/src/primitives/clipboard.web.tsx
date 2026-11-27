import type { CopyText } from "./clipboard";

/** The browser's clipboard. */
const writeText: CopyText = (text) => navigator.clipboard.writeText(text);

/** How to copy text in the browser: `navigator.clipboard`, which needs no provider. */
export function useCopyText(): CopyText | null {
	return writeText;
}
