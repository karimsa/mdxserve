import {
	isAlias,
	isMap,
	isScalar,
	isSeq,
	LineCounter,
	Scalar,
	parseDocument,
	visit,
	type Document,
	type Node,
	type YAMLMap,
} from "yaml";
import { leadingFrontmatter } from "../docs/frontmatter.js";
import {
	commentThreadSchema,
	MAX_MESSAGES_PER_THREAD,
	type CommentAuthor,
	type CommentDiagnostic,
	type CommentThread,
} from "./schema.js";

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

export type CommentsEdit =
	| { kind: "add-thread"; thread: CommentThread }
	| {
			kind: "add-message";
			threadId: string;
			message: { id: string; author: CommentAuthor; body: string; createdAt?: string };
	  }
	| { kind: "edit-message"; threadId: string; messageId: string; body: string; editedAt: string }
	| { kind: "set-resolved"; threadId: string; resolved: boolean };

export type EditCommentsResult =
	| { kind: "ok"; yaml: string }
	| { kind: "invalid-frontmatter"; message: string }
	| { kind: "thread-not-found" }
	| { kind: "thread-full" }
	| { kind: "message-not-found" }
	| { kind: "not-editable" };

function messageIdOf(node: unknown): string | undefined {
	if (!isMap(node)) return undefined;
	const id = node.get("id");
	return typeof id === "string" ? id : undefined;
}

/** The first valid thread map with this id: the same one `parseComments` would return. */
function findThread(list: { items: unknown[] }, threadId: string): YAMLMap | undefined {
	for (const item of list.items) {
		const read = readThreadNode(item);
		if (read.ok && read.thread.id === threadId && isMap(item)) return item;
	}
	return undefined;
}

/**
 * A block scalar cannot carry trailing whitespace or carriage returns through
 * the closing `---` fence (the fence ends the block), so those bodies are
 * written double-quoted, where every character is escaped explicitly.
 */
function bodyScalar(body: string): Scalar<string> {
	const scalar = new Scalar(body);
	if (/\s$|[\r\u0085\u2028\u2029]/.test(body)) scalar.type = Scalar.QUOTE_DOUBLE;
	return scalar;
}

function messageNode(document: Document, message: object & { body: string }) {
	const node: unknown = document.createNode({ ...message, body: "" });
	if (isMap(node)) (node as YAMLMap).set("body", bodyScalar(message.body));
	return node as YAMLMap;
}

/**
 * Turn one YAML string into the next by applying a comment edit to its nodes.
 * Other keys, other threads, invalid entries, and YAML comments are left alone.
 */
export function editComments(yamlText: string | undefined, edit: CommentsEdit): EditCommentsResult {
	const document: Document = parseDocument(yamlText ?? "", { uniqueKeys: true });
	if (document.errors.length)
		return { kind: "invalid-frontmatter", message: document.errors[0].message };
	if (
		document.contents === null ||
		(isScalar(document.contents) && document.contents.value === null)
	)
		document.contents = document.createNode({}) as YAMLMap;
	const root = document.contents;
	if (!isMap(root))
		return { kind: "invalid-frontmatter", message: "Frontmatter must be a YAML map." };

	let list = root.get("comments", true);
	if (list === undefined || (isScalar(list) && list.value === null)) {
		if (edit.kind !== "add-thread") return { kind: "thread-not-found" };
		root.set("comments", document.createNode([]));
		list = root.get("comments", true);
	}
	if (!isSeq(list))
		return { kind: "invalid-frontmatter", message: "The comments key must be a list." };

	if (edit.kind === "add-thread") {
		const node: unknown = document.createNode({ ...edit.thread, messages: [] });
		if (isMap(node)) {
			(node as YAMLMap).set(
				"messages",
				document.createNode(edit.thread.messages.map((message) => messageNode(document, message))),
			);
		}
		list.add(node);
	} else {
		const thread = findThread(list, edit.threadId);
		if (!thread) return { kind: "thread-not-found" };
		if (edit.kind === "set-resolved") {
			thread.set("resolved", edit.resolved);
		} else {
			const messages = thread.get("messages", true);
			if (!isSeq(messages)) return { kind: "thread-not-found" };
			if (edit.kind === "add-message") {
				// One more would fail the thread schema, and the reader would then skip the whole thread.
				if (messages.items.length >= MAX_MESSAGES_PER_THREAD) return { kind: "thread-full" };
				messages.add(messageNode(document, edit.message));
			} else {
				const message = messages.items.find((item) => messageIdOf(item) === edit.messageId);
				if (!isMap(message)) return { kind: "message-not-found" };
				if (message.get("author") === "agent") return { kind: "not-editable" };
				message.set("body", bodyScalar(edit.body));
				message.set("editedAt", edit.editedAt);
			}
		}
	}
	return { kind: "ok", yaml: document.toString({ lineWidth: 0 }) };
}
