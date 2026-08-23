import fs from "node:fs";
import path from "node:path";
import { readTree, type TreeNode } from "./listing.js";

export interface SearchResult {
	path: string;
	title: string;
	excerpt: string;
}

interface CachedDoc {
	mtime: number;
	title: string;
	lines: string[];
}

const MAX_READ_BYTES = 64 * 1024;
const MAX_RESULTS = 30;
const EXCERPT_LENGTH = 120;

// Keyed by absolute filesystem path; invalidated whenever the file's mtime
// changes. Fine to stat on every request — this only ever serves localhost.
const docCache = new Map<string, CachedDoc>();

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

function readDoc(absPath: string, name: string, mtime: number): CachedDoc {
	const cached = docCache.get(absPath);
	if (cached && cached.mtime === mtime) return cached;

	let raw = "";
	try {
		const fd = fs.openSync(absPath, "r");
		try {
			const stat = fs.fstatSync(fd);
			const size = Math.min(stat.size, MAX_READ_BYTES);
			const buffer = Buffer.alloc(size);
			fs.readSync(fd, buffer, 0, size, 0);
			raw = buffer.toString("utf8");
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		raw = "";
	}

	const lines = raw.split(/\r?\n/);
	const headingLine = lines.find((l) => /^#\s+/.test(l));
	const title = headingLine ? stripMarkdown(headingLine.replace(/^#\s+/, "")) : name;

	const doc: CachedDoc = { mtime, title, lines };
	docCache.set(absPath, doc);
	return doc;
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
			const doc = readDoc(absPath, node.name, node.mtime ?? 0);
			return { path: node.path, title: doc.title, excerpt: firstExcerpt(doc.lines) };
		});
		return { results };
	}

	const titleMatches: SearchResult[] = [];
	const bodyMatches: SearchResult[] = [];

	for (const node of nodes) {
		const absPath = path.join(root, node.path);
		const doc = readDoc(absPath, node.name, node.mtime ?? 0);

		const titleHit = doc.title.toLowerCase().includes(query);
		const bodyLine = doc.lines.find((l) => !/^#/.test(l.trim()) && l.toLowerCase().includes(query));
		const anyBodyHit =
			bodyLine !== undefined || doc.lines.some((l) => l.toLowerCase().includes(query));

		if (!titleHit && !anyBodyHit) continue;

		const excerpt = bodyLine
			? truncate(stripMarkdown(bodyLine), EXCERPT_LENGTH)
			: firstExcerpt(doc.lines);
		const result: SearchResult = { path: node.path, title: doc.title, excerpt };

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
