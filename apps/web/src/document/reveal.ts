import type { DocumentIndex, TabStep } from "./document-index";
import { selectTabs } from "./tabs-state";

interface OpenDocument {
	path: string;
	index: DocumentIndex;
}

/** The document on screen, registered by `DocumentView`; null between documents. */
let openDocument: OpenDocument | null = null;

export function setOpenDocument(next: OpenDocument): void {
	openDocument = next;
}

/** Forget `registered`, unless another document has replaced it already. */
export function clearOpenDocument(registered: OpenDocument): void {
	if (openDocument === registered) openDocument = null;
}

/** The element a node renders as: its anchor id, else the `data-node-id` an edit wrapper carries. */
function elementFor(id: string): HTMLElement | null {
	const byId = document.getElementById(id);
	if (byId) return byId;
	for (const element of document.querySelectorAll<HTMLElement>("[data-node-id]")) {
		if (element.dataset.nodeId === id) return element;
	}
	return null;
}

/** A tab panel scrolls its `Tabs` into view, so the tab list stays on screen above it. */
function scrollTargetFor(id: string): HTMLElement | null {
	const element = elementFor(id);
	if (element?.hasAttribute("data-tab-panel")) {
		return element.closest<HTMLElement>("[data-tabs]") ?? element;
	}
	return element;
}

function afterCommit(changed: boolean, task: () => void): void {
	// Selecting a tab re-renders the Tabs; scroll once the panel is shown, or
	// the target still measures as hidden (no box, nowhere to scroll to).
	if (changed) requestAnimationFrame(() => task());
	else task();
}

/**
 * Show the node `id` of the open document: select every tab on the path to
 * it, outermost first, then scroll it into view. False when the open document
 * has no such node. Every way into a node goes through here: the table of
 * contents, a `#fragment`, a search result and a comment.
 */
export function revealNode(id: string, options: { behavior?: ScrollBehavior } = {}): boolean {
	const open = openDocument;
	if (!open) return false;
	const steps = open.index.tabSteps.get(id);
	if (steps === undefined && !elementFor(id)) return false;
	const changed = selectTabs(open.path, steps ?? []);
	afterCommit(changed, () => {
		scrollTargetFor(id)?.scrollIntoView({ block: "start", behavior: options.behavior });
	});
	return true;
}

/** The tabs to select, outermost first, for `element` to be visible. */
function tabStepsOf(element: Element): TabStep[] {
	const steps: TabStep[] = [];
	for (
		let panel = element.closest<HTMLElement>("[data-tab-panel]");
		panel;
		panel = panel.parentElement?.closest<HTMLElement>("[data-tab-panel]") ?? null
	) {
		const tabsId = panel.dataset.tabsId;
		const value = panel.dataset.tabValue;
		if (tabsId !== undefined && value !== undefined) steps.unshift({ tabsId, value });
	}
	return steps;
}

/**
 * Select the tabs that hide `element`, for a target found in the page rather
 * than by id (a comment's anchor). Calls `then` once the element can be
 * measured.
 */
export function revealElement(element: Element, then: () => void): void {
	const open = openDocument;
	const changed = open ? selectTabs(open.path, tabStepsOf(element)) : false;
	afterCommit(changed, then);
}
