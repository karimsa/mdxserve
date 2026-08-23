import fs from "node:fs";
import path from "node:path";
import { toHtml } from "hast-util-to-html";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toHast } from "mdast-util-to-hast";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { toString as mdastToString } from "mdast-util-to-string";
import { mdxjs } from "micromark-extension-mdxjs";
import type { Nodes, PhrasingContent } from "mdast";

export interface CachedDoc {
	mtime: number;
	/** Plain text of the first `#` heading, or undefined when the doc has none. */
	h1?: string;
	/** The same heading rendered as inline HTML (code, emphasis, links, …). */
	h1Html?: string;
	lines: string[];
}

const MAX_READ_BYTES = 64 * 1024;

// Keyed by absolute filesystem path; invalidated whenever the file's mtime
// changes. Fine to stat on every request — this only ever serves localhost.
const docCache = new Map<string, CachedDoc>();

function hasMdxNode(node: Nodes): boolean {
	if (node.type.startsWith("mdx")) return true;
	return "children" in node && node.children.some((child) => hasMdxNode(child as Nodes));
}

// Listing rows are themselves links, so nested anchors would be invalid HTML;
// keep the link text, drop the link.
function unwrapLinks(nodes: PhrasingContent[]): PhrasingContent[] {
	return nodes.flatMap((node) => {
		if (node.type === "link") return unwrapLinks(node.children);
		if ("children" in node) return [{ ...node, children: unwrapLinks(node.children) }];
		return [node];
	});
}

/**
 * Render a single `# heading` line to plain text plus inline HTML. Raw HTML in
 * the source is dropped by `toHast`, so the output only ever contains
 * markdown-derived elements.
 */
function parseHeading(line: string | undefined, isMdx: boolean): { h1?: string; h1Html?: string } {
	if (!line) return {};
	let root;
	try {
		root = isMdx
			? fromMarkdown(line, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] })
			: fromMarkdown(line);
	} catch {
		// Unparseable MDX (e.g. an unclosed JSX tag); treat as untitled.
		return {};
	}
	const heading = root.children[0];
	if (heading?.type !== "heading") return {};
	// MDX headings like `# {meta.title}` or `# <Logo />` can't be resolved
	// statically; fall back to having no title rather than showing the source.
	if (hasMdxNode(heading)) return {};
	const text = mdastToString(heading).trim();
	if (!text) return {};
	const hast = toHast({ type: "root", children: unwrapLinks(heading.children) });
	return { h1: text, h1Html: toHtml(hast) };
}

/**
 * First ATX h1 line outside of fenced code blocks, so a `# comment` inside a
 * shell/python snippet ahead of the real heading isn't mistaken for a title.
 */
function findHeadingLine(lines: string[]): string | undefined {
	let fence: string | null = null;
	for (const line of lines) {
		const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (match) {
			const marker = match[1];
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
			continue;
		}
		if (fence) continue;
		if (/^#\s+\S/.test(line)) return line;
	}
	return undefined;
}

/**
 * Read (up to the first 64 KiB of) a doc and extract its first h1. Results
 * are cached by path + mtime.
 */
export function readDoc(absPath: string, mtime: number): CachedDoc {
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
	const headingLine = findHeadingLine(lines);
	const isMdx = path.extname(absPath).toLowerCase() === ".mdx";
	const { h1, h1Html } = parseHeading(headingLine, isMdx);

	const doc: CachedDoc = { mtime, h1, h1Html, lines };
	docCache.set(absPath, doc);
	return doc;
}
