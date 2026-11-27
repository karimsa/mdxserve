import { useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { tocModeAtom } from "../state";
import { tocPresentation } from "./toc-mode";
import { useToc, type TocEntry } from "./useToc";
import { revealNode } from "../document/reveal";

export interface DocToc {
	path: string;
	version: number;
	items: TocEntry[];
	activeId: string | undefined;
	/** Scrolls to a heading and records it in the URL. */
	select: (id: string) => void;
	/** Rail classes, or null when this mode (or this doc) has no rail. */
	rail: string | null;
	/** Top-bar button, or undefined when there is nothing for it to open. */
	button: { onOpen: () => void; className: string } | undefined;
	above: boolean;
	popupOpen: boolean;
	closePopup: () => void;
}

/**
 * The current doc's table of contents and where the saved mode puts it. One
 * table of contents feeds the rail, the top-bar button's popup and the inline list.
 * A doc without an h2 has no table of contents in any mode, and neither does
 * a route that is not a doc (an empty `path`).
 */
export function useDocToc(path: string, version: number): DocToc {
	const { items, activeId, setActiveId } = useToc(path, version);
	const mode = useAtomValue(tocModeAtom);
	const [popupOpen, setPopupOpen] = useState(false);
	// An empty path is a route that is not a doc.
	const hasHeadings = path !== "" && items.some((item) => item.level === 2);
	const presentation = tocPresentation(mode);

	const select = useCallback(
		(id: string) => {
			setActiveId(id);
			history.replaceState(null, "", `#${id}`);
			revealNode(id);
		},
		[setActiveId],
	);
	const openPopup = useCallback(() => setPopupOpen(true), []);
	const closePopup = useCallback(() => setPopupOpen(false), []);

	const buttonClass = hasHeadings ? presentation.button : null;
	const button = useMemo(
		() => (buttonClass === null ? undefined : { onOpen: openPopup, className: buttonClass }),
		[buttonClass, openPopup],
	);

	return {
		path,
		version,
		items,
		activeId,
		select,
		rail: hasHeadings ? presentation.rail : null,
		button,
		above: hasHeadings && presentation.above,
		// Nothing to show once the button that opened it is gone (mode changed, doc changed).
		popupOpen: popupOpen && button !== undefined,
		closePopup,
	};
}
