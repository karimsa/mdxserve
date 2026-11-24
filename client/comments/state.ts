import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/** Desktop sidebar open state; persisted. Takes the table-of-contents rail's place while open. */
export const commentsOpenAtom = atomWithStorage<boolean>(
	"mdxserve.comments.open",
	false,
	undefined,
	{
		getOnInit: true,
	},
);

/** Phone sheet open state; never persisted, or the sheet would cover the page on every load. */
export const commentsSheetOpenAtom = atom(false);

/** The focused thread, drawn with the active highlight and marked in the panel. */
export const activeThreadAtom = atom<string | null>(null);
