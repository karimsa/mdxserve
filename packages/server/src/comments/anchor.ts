import type { Root, RootContent } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import type { Diagnostic } from "../validation/validate.js";
import { MAX_ANCHOR_HEADING, type CommentThread } from "./schema.js";

/** Collapse runs of whitespace to one space, then trim. Must match `apps/web/src/comments/anchor.ts`. */
export function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * The comparison key of a heading: its normalized text cut to the stored
 * heading limit. Must match `headingKey` in `apps/web/src/comments/anchor.ts`, which
 * is what the browser stores, so a heading longer than the limit still matches.
 * @internal Exported for its tests.
 */
export function headingKey(text: string): string {
	return normalizeText(text).slice(0, MAX_ANCHOR_HEADING).trimEnd();
}

type AnchorState = "exact" | "block" | "section" | "detached";

interface StaticBlock {
	text: string;
	/** Index into `headings` of the block's section, or -1 before the first heading. */
	section: number;
}

interface Collected {
	blocks: StaticBlock[];
	headings: string[];
}

/**
 * Blocks in document order, with the section each belongs to.
 * @internal Exported for its tests.
 */
export function collectBlocks(tree: Root): Collected {
	const blocks: StaticBlock[] = [];
	const headings: string[] = [];
	let section = -1;

	function visit(node: RootContent | Root) {
		switch (node.type) {
			case "heading": {
				headings.push(normalizeText(mdastToString(node)));
				section = headings.length - 1;
				blocks.push({ text: headings[section], section });
				return;
			}
			case "paragraph":
			case "tableCell":
				blocks.push({ text: normalizeText(mdastToString(node)), section });
				return;
			case "code":
				blocks.push({ text: normalizeText(node.value), section });
				return;
			default:
				break;
		}
		if ("children" in node && Array.isArray(node.children)) {
			for (const child of node.children as RootContent[]) visit(child);
		}
	}

	visit(tree);
	return { blocks, headings };
}

/**
 * Static approximation of the browser's anchor resolution, over the mdast tree.
 * @internal Exported for its tests.
 */
export function resolveAnchorStatically(
	collected: Collected,
	anchor: CommentThread["anchor"],
): AnchorState {
	const { blocks, headings } = collected;
	let matching: Set<number>;
	if (anchor.heading === null) matching = new Set([-1]);
	else {
		matching = new Set<number>();
		const wanted = headingKey(anchor.heading);
		headings.forEach((text, index) => {
			if (headingKey(text) === wanted) matching.add(index);
		});
		if (matching.size === 0) return "detached";
	}
	const wantedBlock = normalizeText(anchor.block);
	const block = blocks.find(
		(candidate) => matching.has(candidate.section) && candidate.text.endsWith(wantedBlock),
	);
	if (!block) return "section";
	return block.text.includes(normalizeText(anchor.quote)) ? "exact" : "block";
}

/**
 * `comment-anchor` warnings for open threads whose heading or block cannot be
 * found in the doc. Text a component renders from props is invisible here, so
 * these are advisory.
 */
export function anchorDiagnostics(
	tree: Root,
	threads: CommentThread[],
	positions: ReadonlyMap<string, { line: number; column: number }> = new Map(),
): Diagnostic[] {
	const open = threads.filter((thread) => !thread.resolved);
	if (open.length === 0) return [];
	const collected = collectBlocks(tree);
	const diagnostics: Diagnostic[] = [];
	for (const thread of open) {
		const state = resolveAnchorStatically(collected, thread.anchor);
		if (state !== "detached" && state !== "section") continue;
		const position = positions.get(thread.id);
		diagnostics.push({
			severity: "warning",
			code: "comment-anchor",
			message:
				state === "detached"
					? `Comment thread "${thread.id}": the heading "${thread.anchor.heading}" no longer exists.`
					: thread.anchor.heading === null
						? `Comment thread "${thread.id}": its text was not found before the first heading.`
						: `Comment thread "${thread.id}": its text was not found under the heading "${thread.anchor.heading}".`,
			...(position ? { line: position.line, column: position.column } : {}),
		});
	}
	return diagnostics;
}
