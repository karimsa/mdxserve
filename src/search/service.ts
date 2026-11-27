import fs from "node:fs";
import path from "node:path";
import MiniSearch, { type SearchResult as MiniSearchHit } from "minisearch";
import { readTree, type TreeNode } from "../listing/tree.js";
import type { DocCache } from "../docs/doc-cache.js";
import type { RootInfo } from "../roots/root-info.js";
import type { DocumentService } from "../document/service.js";
import { leadingFrontmatter } from "../docs/frontmatter.js";

export interface SearchResult {
	path: string;
	/** Display label: `"<rootName>/<relative path>"`. */
	label: string;
	title: string;
	excerpt: string;
	/** Query terms MiniSearch matched for this hit, for client-side highlighting. */
	terms: string[];
	/** MiniSearch's relevance score for this hit; 1 for an empty (tree-order) query. */
	score: number;
	/**
	 * The ID, in the `getDocument` tree, of the innermost section or tab that
	 * contains the hit line (the line the excerpt came from); null when there
	 * is no hit line, it lies outside every section and tab, or no
	 * `DocumentService` was given.
	 */
	targetId: string | null;
}

/** The lines of a section or tab, by its ID in the document tree. */
interface TargetRange {
	id: string;
	startLine: number;
	endLine: number;
}

interface TargetRanges {
	mtime: number;
	ranges: TargetRange[];
	/** How many file lines come before the first body line (the frontmatter's). */
	offset: number;
}

interface ClassifiedLines {
	headings: string[];
	body: string[];
	/** Index into the body lines of each entry of `headings`. */
	headingIndexes: number[];
	/** Index into the body lines of each entry of `body`. */
	bodyIndexes: number[];
}

// Larger docs are searchable but get no target: parsing one per hit is not worth it.
const MAX_TARGET_BYTES = 2 * 1024 * 1024;

/** Every section ID and tab ID in a document tree, however deeply it is nested. */
function collectTargetIds(node: unknown, out: Set<string>): void {
	if (Array.isArray(node)) {
		for (const child of node) collectTargetIds(child, out);
		return;
	}
	if (typeof node !== "object" || node === null) return;
	const record = node as Record<string, unknown>;
	if (record.type === "section" && typeof record.id === "string") out.add(record.id);
	if (record.type === "tabs" && Array.isArray(record.tabs)) {
		for (const tab of record.tabs as { id?: unknown }[]) {
			if (typeof tab?.id === "string") out.add(tab.id);
		}
	}
	for (const value of Object.values(record)) collectTargetIds(value, out);
}

interface IndexedDoc {
	id: string;
	title: string;
	/** `"<rootName>/<relative path>"` — searchable, and reused as the display label. */
	path: string;
	/** Section headings (h2+) with their `#` markers stripped. */
	headings: string;
	body: string;
	mtime: number;
}

const MAX_RESULTS = 30;
const EXCERPT_LENGTH = 120;

function stripMarkdown(text: string): string {
	return text
		.replace(/[`*_~]/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.trim();
}

function truncate(text: string, length: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= length) return trimmed;
	return `${trimmed.slice(0, length).trimEnd()}…`;
}

function flatten(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
	for (const node of nodes) {
		if (node.isDoc) out.push(node);
		if (node.children) flatten(node.children, out);
	}
	return out;
}

/**
 * Split a doc into section headings (h2+, `#` markers stripped) and body
 * lines. h1 lines are dropped: the title field already carries that text.
 * Anything inside fenced code is body, so a `# comment` in a shell snippet
 * isn't mistaken for a heading.
 */
function classifyLines(lines: string[]): ClassifiedLines {
	const headings: string[] = [];
	const body: string[] = [];
	const headingIndexes: number[] = [];
	const bodyIndexes: number[] = [];
	let fence: string | null = null;
	let titleSeen = false;
	for (const [index, line] of lines.entries()) {
		const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (match) {
			const marker = match[1];
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
			body.push(line);
			bodyIndexes.push(index);
			continue;
		}
		// Drop only the first unindented h1 — the line DocCache.read stores as the
		// title field. Every other h1 stays searchable as a heading.
		if (!fence && !titleSeen && /^#\s+\S/.test(line)) {
			titleSeen = true;
			continue;
		}
		if (!fence && /^\s{0,3}#{1,6}\s/.test(line)) {
			headings.push(line.replace(/^\s*#+\s*/, ""));
			headingIndexes.push(index);
		} else {
			body.push(line);
			bodyIndexes.push(index);
		}
	}
	return { headings, body, headingIndexes, bodyIndexes };
}

function firstExcerpt(body: string[]): string {
	const line = body.find((candidate) => candidate.trim() !== "");
	return line ? truncate(stripMarkdown(line), EXCERPT_LENGTH) : "";
}

/**
 * Excerpt for a hit: the first section heading, else the first body line,
 * containing any of the terms MiniSearch matched — so the preview shows why
 * the result appeared. Falls back to the doc's first body line. `bodyIndex`
 * is where the matching line sits among the doc's body lines (see
 * `bodyLines`), or null when the excerpt is the fallback.
 */
function matchExcerpt(
	classified: ClassifiedLines,
	terms: string[],
): { excerpt: string; bodyIndex: number | null } {
	const { headings, body, headingIndexes, bodyIndexes } = classified;
	const lowered = terms.map((term) => term.toLowerCase());
	const hit = (line: string) => {
		const lc = line.toLowerCase();
		return lowered.some((term) => lc.includes(term));
	};
	const headingAt = headings.findIndex(hit);
	if (headingAt !== -1) {
		return {
			excerpt: truncate(stripMarkdown(headings[headingAt]), EXCERPT_LENGTH),
			bodyIndex: headingIndexes[headingAt],
		};
	}
	const bodyAt = body.findIndex(hit);
	if (bodyAt !== -1) {
		return {
			excerpt: truncate(stripMarkdown(body[bodyAt]), EXCERPT_LENGTH),
			bodyIndex: bodyIndexes[bodyAt],
		};
	}
	return { excerpt: firstExcerpt(body), bodyIndex: null };
}

/**
 * One MiniSearch index for the whole server, spanning every mounted root,
 * kept in sync incrementally: every search diffs the current trees (path +
 * mtime) against what's indexed and only re-reads docs that were added,
 * changed, or removed. Doc ids are absolute paths, so they never collide
 * across roots and scores are directly comparable.
 */
export class SearchService {
	constructor(
		private readonly docCache: DocCache,
		private readonly document?: DocumentService,
	) {}

	/** The section and tab ranges of each parsed doc, valid for the mtime they were computed at. */
	private readonly targetRanges = new Map<string, TargetRanges>();

	/** The ranges of every section and tab in a doc; empty when it cannot be read or parsed. */
	private rangesOf(absPath: string, mtime: number): TargetRanges {
		const empty = { mtime, ranges: [], offset: 0 };
		const document = this.document;
		if (!document) return empty;
		const cached = this.targetRanges.get(absPath);
		if (cached && cached.mtime === mtime) return cached;

		let ranges: TargetRange[] = [];
		let offset = 0;
		try {
			if (fs.statSync(absPath).size <= MAX_TARGET_BYTES) {
				const source = fs.readFileSync(absPath, "utf8");
				// bodyLines starts after the frontmatter, so a body index is a file
				// line only once the frontmatter's own lines are added back.
				offset = leadingFrontmatter(source)?.endLine ?? 0;
				const parsed = document.parse(source, absPath);
				const ids = new Set<string>();
				collectTargetIds(parsed.tree.children, ids);
				ranges = [...ids].flatMap((id) => {
					const range = parsed.ranges.get(id);
					return range ? [{ id, ...range }] : [];
				});
			}
		} catch {
			ranges = [];
		}
		const entry = { mtime, ranges, offset };
		this.targetRanges.set(absPath, entry);
		return entry;
	}

	/**
	 * The innermost section or tab containing body line `bodyIndex` (0-based,
	 * counted after the frontmatter), or null.
	 */
	private targetIdFor(absPath: string, mtime: number, bodyIndex: number | null): string | null {
		if (bodyIndex === null || !this.document) return null;
		const { ranges, offset } = this.rangesOf(absPath, mtime);
		const line = offset + bodyIndex + 1;
		let best: TargetRange | null = null;
		for (const range of ranges) {
			if (line < range.startLine || line > range.endLine) continue;
			if (!best || range.endLine - range.startLine <= best.endLine - best.startLine) best = range;
		}
		return best?.id ?? null;
	}

	private readonly mini = new MiniSearch<IndexedDoc>({
		fields: ["title", "path", "headings", "body"],
		storeFields: ["title", "path"],
		// Split the path field on separators too, so `nested-page` and
		// `deep` match `docs/nested/deep/05-nested-page.md`.
		tokenize: (text, fieldName) =>
			fieldName === "path"
				? text.split(/[/\-_.\s]+/).filter(Boolean)
				: MiniSearch.getDefault("tokenize")(text),
		searchOptions: {
			boost: { title: 3, path: 2, headings: 2 },
			prefix: true,
			fuzzy: 0.2,
			combineWith: "AND",
		},
	});
	private readonly indexed = new Map<string, IndexedDoc>();

	/** Bring the index up to date and return the docs in tree order. */
	sync(roots: RootInfo[], publicOnly = false): TreeNode[] {
		const allNodes: TreeNode[] = [];
		const seen = new Set<string>();

		for (const root of roots) {
			const nodes = flatten(readTree(root.dir, 8, publicOnly ? root.dir : undefined));
			for (const node of nodes) {
				allNodes.push(node);
				seen.add(node.path);
				const mtime = node.mtime ?? 0;
				// The label carries the root's display name, which can change
				// between calls when roots with colliding basenames come and go
				// (the stdio bridge unions roots from independent servers), so a
				// label change must re-index just like an edit does.
				const label = `${root.name}/${path.relative(root.dir, node.path)}`;
				const existing = this.indexed.get(node.path);
				if (existing && existing.mtime === mtime && existing.path === label) continue;

				const doc = this.docCache.read(node.path, mtime);
				const { headings, body } = classifyLines(doc.bodyLines);
				const entry: IndexedDoc = {
					id: node.path,
					title: doc.h1 ?? node.name,
					path: label,
					headings: headings.join("\n"),
					body: body.join("\n"),
					mtime,
				};
				// `remove` (not `replace`/`discard`): MiniSearch only marks a discarded
				// doc and keeps counting it toward document count and term frequencies
				// until an async vacuum, which skews BM25 so an edited doc outranks an
				// identical unedited one. `remove` needs the exact indexed fields,
				// which is why the previous entry is kept in `indexed`.
				if (existing) this.mini.remove(existing);
				this.mini.add(entry);
				this.indexed.set(node.path, entry);
			}
		}

		for (const [id, entry] of this.indexed) {
			if (seen.has(id)) continue;
			this.mini.remove(entry);
			this.indexed.delete(id);
		}

		return allNodes;
	}

	/**
	 * Full-text search of doc titles and bodies across every mounted root for
	 * `rawQuery`, powered by MiniSearch (prefix + light fuzzy matching, titles boosted).
	 * Purely data — no HTML.
	 */
	search(roots: RootInfo[], rawQuery: string, publicOnly = false): { results: SearchResult[] } {
		const nodes = this.sync(roots, publicOnly);
		const query = rawQuery.trim();

		if (query === "") {
			return {
				results: nodes.slice(0, MAX_RESULTS).map((node) => {
					const doc = this.docCache.read(node.path, node.mtime ?? 0);
					return {
						path: node.path,
						label: this.indexed.get(node.path)?.path ?? node.name,
						title: doc.h1 ?? node.name,
						excerpt: firstExcerpt(classifyLines(doc.bodyLines).body),
						terms: [],
						score: 1,
						targetId: null,
					};
				}),
			};
		}

		const byPath = new Map(nodes.map((node) => [node.path, node]));
		const hits: MiniSearchHit[] = this.mini.search(query).slice(0, MAX_RESULTS);

		return {
			results: hits.flatMap((hit) => {
				const node = byPath.get(hit.id as string);
				if (!node) return [];
				const doc = this.docCache.read(node.path, node.mtime ?? 0);
				const terms = hit.terms.length > 0 ? hit.terms : [query];
				const { excerpt, bodyIndex } = matchExcerpt(classifyLines(doc.bodyLines), terms);
				return [
					{
						path: node.path,
						label: (hit.path as string | undefined) ?? node.name,
						title: (hit.title as string | undefined) ?? doc.h1 ?? node.name,
						excerpt,
						terms,
						score: hit.score,
						targetId: this.targetIdFor(node.path, node.mtime ?? 0, bodyIndex),
					},
				];
			}),
		};
	}
}
