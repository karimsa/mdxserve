import { createContext } from "react";
import type { TextMark } from "@mdxserve/client/comments/marks";

/**
 * What the app's text renderers read to draw comment highlights (elements.tsx): the marks on
 * each text, inline code and code node, and which thread is active. Only the app provides it;
 * the web draws its highlights with the CSS Custom Highlight API and never imports this file.
 */
export interface CommentMarks {
	/** Calls `listener` when any node's marks or the active thread change. */
	subscribe(listener: () => void): () => void;
	/** The marks on a text, inlineCode or code node. The same array until they change. */
	marksOf(source: object): readonly TextMark[] | undefined;
	activeThread(): string | null;
	/** The reader tapped highlighted text that these threads mark. */
	pressMark(threadIds: readonly string[]): void;
}

export const CommentMarksContext = createContext<CommentMarks | null>(null);
