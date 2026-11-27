import { LayoutGroup } from "framer-motion";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TocList } from "../ui/TocList";
import type { DocToc } from "./useDocToc";

/** Where the host belongs: `parent`, immediately before `before` (null for last). */
function slot(article: Element): { parent: Element; before: ChildNode | null } {
	const titles = Array.from(article.querySelectorAll("h1"));
	// A section being edited is the editor's own DOM: never insert into it.
	const title = titles.find((heading) => !heading.closest("[data-editing]"));
	if (title?.parentElement) return { parent: title.parentElement, before: title.nextSibling };
	// The title's section is open in the editor: wait right below it.
	let editing: Element | null = titles[0] ?? null;
	while (editing && editing.parentElement !== article) editing = editing.parentElement;
	if (editing) return { parent: article, before: editing.nextSibling };
	// No title at all: the list leads the article.
	return { parent: article, before: article.firstChild };
}

/** Moves the host to its slot unless it is already there. */
function place(article: Element, host: HTMLElement): void {
	const { parent, before } = slot(article);
	if (before === host) return;
	if (host.parentElement === parent && host.nextSibling === before) return;
	parent.insertBefore(host, before);
}

/**
 * The table of contents inline, between the doc's title and its content. The
 * article is drawn by the document view, so the list is portalled into a host
 * element this component inserts right after the h1 and keeps there: the
 * document view never has to know about it, and a section editor or an in-place doc
 * update that replaces the title does not strand it.
 */
export function TocAbove({ toc }: { toc: DocToc }) {
	const [host, setHost] = useState<HTMLElement | null>(null);
	const { above, path, version } = toc;

	useLayoutEffect(() => {
		if (!above) return;
		const article = document.querySelector("article.mdx-prose");
		if (!article) return;
		const element = document.createElement("div");
		// `not-prose` keeps the prose rules off the list; it is navigation, not content.
		element.className = "not-prose";
		element.dataset.tocAbove = "";
		place(article, element);
		setHost(element);
		const observer = new MutationObserver(() => place(article, element));
		observer.observe(article, { childList: true, subtree: true });
		return () => {
			observer.disconnect();
			element.remove();
			setHost(null);
		};
	}, [above, path, version]);

	if (!above || !host) return null;
	return createPortal(
		<LayoutGroup id="toc-above">
			<TocList
				items={toc.items}
				activeId={toc.activeId}
				onSelect={toc.select}
				className="rounded-md border border-border-subtle bg-surface-card px-4 py-3.5"
			/>
		</LayoutGroup>,
		host,
	);
}
