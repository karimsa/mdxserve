/**
 * The subset of a `MouseEvent` that decides whether a click on a link inside
 * the section editor should open it. Pure so it can be tested without a DOM.
 */
export interface LinkClick {
	button: number;
	metaKey: boolean;
	ctrlKey: boolean;
}

/**
 * The href a click inside the editor should open in a new tab, or `null` to
 * let ProseMirror place the caret as usual.
 *
 * In read mode a link is a link, so cmd/ctrl+click gets the browser's own
 * new-tab behaviour. Inside the contenteditable that default never fires —
 * the browser treats the anchor as editable text — and Tiptap's Link
 * extension is configured with `openOnClick: false` so a plain click can edit
 * the link's text. That leaves the editor convention every other editor
 * (VS Code, Notion, Google Docs) follows: hold cmd (or ctrl) to follow it.
 */
export function modifiedLinkHref(click: LinkClick, href: string | null | undefined): string | null {
	if (click.button !== 0) return null;
	if (!(click.metaKey || click.ctrlKey)) return null;
	if (!href) return null;
	return href;
}
