import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { documentQueryOptions } from "../document/query";
import { indexDocument } from "@mdxserve/client/document/document-index";
import { FOOTNOTES_ID } from "../document/nodes";
import type { TocEntry as TreeTocEntry } from "../document/tree-types";

export interface TocEntry {
	id: string;
	label: string;
	/** Indent level: 2 for a top entry, one more per step down (a tab, a heading in a tab). */
	level: number;
	kind: "heading" | "tab";
}

function flatten(
	entries: readonly TreeTocEntry[],
	levels: ReadonlyMap<string, number>,
	parentLevel: number | null,
): TocEntry[] {
	return entries.flatMap((entry) => {
		const level =
			parentLevel === null ? Math.min(Math.max(levels.get(entry.id) ?? 2, 2), 3) : parentLevel + 1;
		return [
			{ id: entry.id, label: entry.label, level, kind: entry.kind },
			...flatten(entry.children, levels, level),
		];
	});
}

/**
 * "On this page" data for the current doc, read from the document tree's
 * `toc` (no DOM scan): headings, each `Tabs`'s tabs one level below the
 * heading that holds them, and headings inside a tab below that tab. The
 * entry in view is tracked by observing the rendered anchors, re-attached
 * whenever `version` changes (DocumentView bumps it after each commit).
 */
export function useToc(path: string, version: number) {
	const { data } = useQuery({ ...documentQueryOptions(path), enabled: path !== "" });
	const tree = path === "" ? undefined : data?.document;
	const items = useMemo(() => {
		if (!tree) return [];
		const index = indexDocument(tree);
		const entries = flatten(tree.toc, index.sectionLevels, null);
		// The footnotes list is drawn by the client, so the server's contents
		// have no entry for its heading; add it last, where the list renders.
		if (index.footnotes.length > 0)
			entries.push({ id: FOOTNOTES_ID, label: "Footnotes", level: 2, kind: "heading" });
		return entries;
	}, [tree]);
	const [activeId, setActiveId] = useState<string | undefined>(undefined);
	const observerRef = useRef<IntersectionObserver | null>(null);

	useLayoutEffect(() => {
		observerRef.current?.disconnect();
		observerRef.current = null;
		const elements = items
			.map((item) => document.getElementById(item.id))
			.filter((element): element is HTMLElement => element !== null);
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
		for (const element of elements) observer.observe(element);
		observerRef.current = observer;
		return () => {
			observer.disconnect();
			if (observerRef.current === observer) observerRef.current = null;
		};
	}, [items, version]);

	return { items, activeId, setActiveId };
}
