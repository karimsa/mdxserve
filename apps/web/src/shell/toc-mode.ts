import type { TocMode } from "../state";

export interface TocPresentation {
	/** Classes that show the right-hand rail at the widths it has room for; null for no rail. */
	rail: string | null;
	/** Classes for the top-bar button that brings the list out; null for no button. */
	button: string | null;
	/** Whether the list sits inline between the doc's title and its content. */
	above: boolean;
}

/**
 * What each table-of-contents mode puts on the page. The rail and the button
 * are complements: wherever the rail has no room, the button stands in for it,
 * so the list is always reachable unless the mode is `disabled`.
 *
 * `auto` gives the rail from laptop width (`xl`); `right` is the explicit
 * choice, so it takes the rail a breakpoint earlier (`lg`) at the cost of a
 * narrower doc.
 */
export function tocPresentation(mode: TocMode): TocPresentation {
	switch (mode) {
		case "auto":
			return { rail: "hidden xl:block", button: "xl:hidden", above: false };
		case "right":
			return { rail: "hidden lg:block", button: "lg:hidden", above: false };
		case "hidden":
			return { rail: null, button: "", above: false };
		case "above":
			return { rail: null, button: null, above: true };
		case "disabled":
			return { rail: null, button: null, above: false };
	}
}
