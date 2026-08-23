import { useLayoutEffect, useRef, useState } from "react";

export interface TocEntry {
	id: string;
	label: string;
	level: 2 | 3;
}

/** Strips the trailing `#` from the Heading.tsx anchor link (see client/Heading.tsx). */
function stripAnchorGlyph(text: string): string {
	return text.replace(/#\s*$/, "").trim();
}

function collectHeadings(): { entries: TocEntry[]; elements: HTMLElement[] } {
	const article = document.querySelector("article.mdx-prose");
	if (!article) return { entries: [], elements: [] };

	const elements = Array.from(article.querySelectorAll<HTMLElement>("h2, h3")).filter(
		(el) => el.id,
	);
	const entries: TocEntry[] = elements.map((el) => ({
		id: el.id,
		label: stripAnchorGlyph(el.textContent ?? ""),
		level: el.tagName === "H3" ? 3 : 2,
	}));
	return { entries, elements };
}

/**
 * "On this page" data for the current doc. Re-scans `article.mdx-prose` for
 * h2/h3 elements whenever `path` or `version` changes (`version` is bumped by
 * DocView.onRendered — see client/shell/TocRail.tsx — because the article for
 * a given `path` can render asynchronously after this effect first runs, e.g.
 * the initial server-rendered route's module is still importing on mount).
 */
export function useToc(path: string, version: number) {
	const [items, setItems] = useState<TocEntry[]>([]);
	const [activeId, setActiveId] = useState<string | undefined>(undefined);
	const observerRef = useRef<IntersectionObserver | null>(null);

	useLayoutEffect(() => {
		function collect() {
			const { entries, elements } = collectHeadings();
			setItems(entries);

			observerRef.current?.disconnect();
			observerRef.current = null;
			if (elements.length === 0) return;

			const observer = new IntersectionObserver(
				(observed) => {
					for (const entry of observed) {
						if (entry.isIntersecting) {
							setActiveId(entry.target.id);
							break;
						}
					}
				},
				{ root: null, rootMargin: "-60px 0px -70% 0px" },
			);
			for (const el of elements) observer.observe(el);
			observerRef.current = observer;
		}

		collect();

		const hot = import.meta.hot;
		hot?.on("vite:afterUpdate", collect);
		return () => {
			observerRef.current?.disconnect();
			observerRef.current = null;
			hot?.off?.("vite:afterUpdate", collect);
		};
	}, [path, version]);

	return { items, activeId, setActiveId };
}
