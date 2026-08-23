import path from "node:path";
import MiniSearch, { type SearchResult as MiniSearchHit } from "minisearch";
import { readTree, type TreeNode } from "./listing.js";
import { readDoc } from "./doc.js";

export interface SearchResult {
	path: string;
	title: string;
	excerpt: string;
	/** Query terms MiniSearch matched for this hit, for client-side highlighting. */
	terms: string[];
}

interface IndexedDoc {
	id: string;
	title: string;
	path: string;
	/** Section headings (h2+) with their `#` markers stripped. */
	headings: string;
	body: string;
	mtime: number;
}

const MAX_RESULTS = 30;
const EXCERPT_LENGTH = 120;

function stripMarkdown(s: string): string {
	return s
		.replace(/[`*_~]/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.trim();
}

function truncate(s: string, length: number): string {
	const trimmed = s.trim();
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
function classifyLines(lines: string[]): { headings: string[]; body: string[] } {
	const headings: string[] = [];
	const body: string[] = [];
	let fence: string | null = null;
	let titleSeen = false;
	for (const line of lines) {
		const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (match) {
			const marker = match[1];
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
			body.push(line);
			continue;
		}
		// Drop only the first unindented h1 — the line readDoc stores as the
		// title field. Every other h1 stays searchable as a heading.
		if (!fence && !titleSeen && /^#\s+\S/.test(line)) {
			titleSeen = true;
			continue;
		}
		if (!fence && /^\s{0,3}#{1,6}\s/.test(line)) headings.push(line.replace(/^\s*#+\s*/, ""));
		else body.push(line);
	}
	return { headings, body };
}

function firstExcerpt(body: string[]): string {
	const line = body.find((l) => l.trim() !== "");
	return line ? truncate(stripMarkdown(line), EXCERPT_LENGTH) : "";
}

/**
 * Excerpt for a hit: the first section heading, else the first body line,
 * containing any of the terms MiniSearch matched — so the preview shows why
 * the result appeared. Falls back to the doc's first body line.
 */
function matchExcerpt(
	{ headings, body }: { headings: string[]; body: string[] },
	terms: string[],
): string {
	const lowered = terms.map((t) => t.toLowerCase());
	const hit = (l: string) => {
		const lc = l.toLowerCase();
		return lowered.some((t) => lc.includes(t));
	};
	const line = headings.find(hit) ?? body.find(hit);
	return line ? truncate(stripMarkdown(line), EXCERPT_LENGTH) : firstExcerpt(body);
}

/**
 * One MiniSearch index per served root, kept in sync incrementally: every
 * search diffs the current tree (path + mtime) against what's indexed and only
 * re-reads docs that were added, changed, or removed.
 */
class SearchIndex {
	private readonly mini = new MiniSearch<IndexedDoc>({
		fields: ["title", "path", "headings", "body"],
		storeFields: ["title"],
		// Split the path field on separators too, so `nested-page` and
		// `deep` match `/nested/deep/05-nested-page.md`.
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

	constructor(private readonly root: string) {}

	/** Bring the index up to date and return the docs in tree order. */
	sync(): TreeNode[] {
		const nodes = flatten(readTree(this.root, "/"));
		const seen = new Set<string>();

		for (const node of nodes) {
			seen.add(node.path);
			const mtime = node.mtime ?? 0;
			const existing = this.indexed.get(node.path);
			if (existing && existing.mtime === mtime) continue;

			const doc = readDoc(path.join(this.root, node.path), mtime);
			const { headings, body } = classifyLines(doc.lines);
			const entry: IndexedDoc = {
				id: node.path,
				title: doc.h1 ?? node.name,
				path: node.path,
				headings: headings.join("\n"),
				body: body.join("\n"),
				mtime,
			};
			if (existing) this.mini.replace(entry);
			else this.mini.add(entry);
			this.indexed.set(node.path, entry);
		}

		for (const [id] of this.indexed) {
			if (seen.has(id)) continue;
			this.mini.discard(id);
			this.indexed.delete(id);
		}

		return nodes;
	}

	search(q: string): SearchResult[] {
		const nodes = this.sync();
		const query = q.trim();

		if (query === "") {
			return nodes.slice(0, MAX_RESULTS).map((node) => {
				const doc = readDoc(path.join(this.root, node.path), node.mtime ?? 0);
				return {
					path: node.path,
					title: doc.h1 ?? node.name,
					excerpt: firstExcerpt(classifyLines(doc.lines).body),
					terms: [],
				};
			});
		}

		const byPath = new Map(nodes.map((n) => [n.path, n]));
		const hits: MiniSearchHit[] = this.mini.search(query).slice(0, MAX_RESULTS);

		return hits.flatMap((hit) => {
			const node = byPath.get(hit.id as string);
			if (!node) return [];
			const doc = readDoc(path.join(this.root, node.path), node.mtime ?? 0);
			const terms = hit.terms.length > 0 ? hit.terms : [query];
			return [
				{
					path: node.path,
					title: (hit.title as string | undefined) ?? doc.h1 ?? node.name,
					excerpt: matchExcerpt(classifyLines(doc.lines), terms),
					terms,
				},
			];
		});
	}
}

const indexes = new Map<string, SearchIndex>();

/**
 * Full-text search of doc titles and bodies under the served directory `root`
 * for `q`, powered by MiniSearch (prefix + light fuzzy matching, titles
 * boosted). Purely data — no HTML.
 */
export function search(root: string, q: string): { results: SearchResult[] } {
	let index = indexes.get(root);
	if (!index) {
		index = new SearchIndex(root);
		indexes.set(root, index);
	}
	return { results: index.search(q) };
}
