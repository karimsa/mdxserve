import * as Clipboard from "expo-clipboard";
import type { CopyText } from "@mdxserve/ui/primitives/clipboard";

/** The system clipboard for the shared components' copy buttons (`ClipboardContext`). */
export const copyText: CopyText = async (text) => {
	await Clipboard.setStringAsync(text);
};
