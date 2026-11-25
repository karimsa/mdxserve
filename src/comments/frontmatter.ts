import {
	isAlias,
	isMap,
	isScalar,
	isSeq,
	LineCounter,
	parseDocument,
	visit,
	type Node,
} from "yaml";
import { leadingFrontmatter } from "../docs/frontmatter.js";
import { commentThreadSchema, type CommentDiagnostic, type CommentThread } from "./schema.js";

export interface ParsedComments {
	threads: CommentThread[];
	diagnostics: CommentDiagnostic[];
	/** Where each returned thread starts in the source file (1-based). */
	positions: Map<string, { line: number; column: number }>;
}

const SAFE_TAG = /^tag:yaml.org,2002:(?:str|int|float|bool|null|seq|map)$/;

function hasUnsafeNode(node: Node): boolean {
	let unsafe = false;
	visit(node, {
		Node(_key, child) {
			if (isAlias(child) || ("tag" in child && !!child.tag && !SAFE_TAG.test(String(child.tag))))
				unsafe = true;
		},
	});
	return unsafe;
}

function readThreadNode(
	node: unknown,
): { ok: true; thread: CommentThread } | { ok: false; message: string } {
	if (!isMap(node)) return { ok: false, message: "Invalid comment thread: expected a map." };
	if (hasUnsafeNode(node))
		return { ok: false, message: "YAML aliases and custom tags are not supported in comments." };
	const parsed = commentThreadSchema.safeParse(node.toJSON());
	if (!parsed.success) {
		// Name every problem at once, so one validate run is enough to fix the entry.
		const problems = parsed.error.issues
			.slice(0, 5)
			.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ` : "") + issue.message);
		return {
			ok: false,
			message: `Invalid comment thread: ${problems.join("; ") || "does not match the schema"}.`,
		};
	}
	return { ok: true, thread: parsed.data };
}

/** Parse the `comments` list of an already-extracted YAML block. `startLine` is the block's first line in the file. */
export function parseCommentsYaml(yamlText: string, startLine = 1): ParsedComments {
	const result: ParsedComments = { threads: [], diagnostics: [], positions: new Map() };
	const counter = new LineCounter();
	const document = parseDocument(yamlText, { uniqueKeys: true, lineCounter: counter });
	// parseMetadata already reports YAML errors; say nothing twice.
	if (document.errors.length || !isMap(document.contents)) return result;

	const locate = (node: unknown) => {
		const offset = (node as Node | null | undefined)?.range?.[0];
		if (offset === undefined) return {};
		const position = counter.linePos(offset);
		return { line: startLine + position.line - 1, column: position.col };
	};
	const warn = (message: string, node?: unknown) =>
		result.diagnostics.push({
			severity: "warning",
			code: "frontmatter-comments",
			message,
			...locate(node),
		});

	const list = document.contents.get("comments", true);
	if (list === undefined || (isScalar(list) && list.value === null)) return result;
	if (!isSeq(list)) {
		warn("Invalid comments: expected a list of threads.", list);
		return result;
	}

	for (const item of list.items) {
		const read = readThreadNode(item);
		if (!read.ok) {
			warn(read.message, item);
			continue;
		}
		const { thread } = read;
		if (result.positions.has(thread.id)) {
			warn(`Duplicate comment thread id "${thread.id}"; the first one is used.`, item);
			continue;
		}
		const seen = new Set<string>();
		const messages = thread.messages.filter((message) => {
			if (!seen.has(message.id)) {
				seen.add(message.id);
				return true;
			}
			warn(
				`Duplicate message id "${message.id}" in comment thread "${thread.id}"; the first one is used.`,
				item,
			);
			return false;
		});
		result.threads.push({ ...thread, messages });
		const where = locate(item);
		result.positions.set(thread.id, { line: where.line ?? startLine, column: where.column ?? 1 });
	}
	return result;
}

/** Read the comment threads of a whole doc source. Malformed entries become diagnostics and are left out. */
export function parseComments(source: string): ParsedComments {
	const frontmatter = leadingFrontmatter(source);
	if (!frontmatter) return { threads: [], diagnostics: [], positions: new Map() };
	return parseCommentsYaml(frontmatter.value, frontmatter.startLine);
}
