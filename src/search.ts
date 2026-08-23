import path from "node:path";
import { readTree, type TreeNode } from "./listing.js";
import { readDoc } from "./doc.js";

export interface SearchResult {
	path: string;
	title: string;
	excerpt: string;
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
 * Search doc titles and bodies under the served directory `root` for `q`
 * (case-insensitive substring). Purely data — no HTML.
 */
export function search(root: string, q: string): { results: SearchResult[] } {
	const nodes = flatten(readTree(root, "/"));
	const query = q.trim().toLowerCase();

	if (query === "") {
		const results = nodes.slice(0, MAX_RESULTS).map((node) => {
			const absPath = path.join(root, node.path);
			const doc = readDoc(absPath, node.mtime ?? 0);
			return { path: node.path, title: doc.h1 ?? node.name, excerpt: firstExcerpt(doc.lines) };
		});
		return { results };
	}

	const titleMatches: SearchResult[] = [];
	const bodyMatches: SearchResult[] = [];

	for (const node of nodes) {
		const absPath = path.join(root, node.path);
		const doc = readDoc(absPath, node.mtime ?? 0);

		const titleHit = (doc.h1 ?? node.name).toLowerCase().includes(query);
		const bodyLine = doc.lines.find((l) => !/^#/.test(l.trim()) && l.toLowerCase().includes(query));
		const anyBodyHit =
			bodyLine !== undefined || doc.lines.some((l) => l.toLowerCase().includes(query));

		if (!titleHit && !anyBodyHit) continue;

		const excerpt = bodyLine
			? truncate(stripMarkdown(bodyLine), EXCERPT_LENGTH)
			: firstExcerpt(doc.lines);
		const result: SearchResult = { path: node.path, title: doc.h1 ?? node.name, excerpt };

		if (titleHit) titleMatches.push(result);
		else bodyMatches.push(result);

		if (titleMatches.length + bodyMatches.length >= MAX_RESULTS * 4) break;
	}

	return { results: [...titleMatches, ...bodyMatches].slice(0, MAX_RESULTS) };
}

function firstExcerpt(lines: string[]): string {
	const line = lines.find((l) => l.trim() !== "" && !/^#/.test(l.trim()));
	return line ? truncate(stripMarkdown(line), EXCERPT_LENGTH) : "";
}
