import { randomBytes } from "node:crypto";
import type { DocsService } from "../docs/service.js";
import { normalizeText } from "./anchor.js";
import {
	editComments,
	parseComments,
	parseCommentsYaml,
	type CommentsEdit,
} from "./frontmatter.js";
import {
	MAX_ANCHOR_TEXT,
	MAX_MESSAGE_BODY,
	type CommentAnchor,
	type CommentDiagnostic,
	type CommentThread,
} from "./schema.js";

export type CommentsFailure =
	| { kind: "not-found"; message: string }
	| { kind: "invalid-frontmatter"; message: string }
	| { kind: "too-large" }
	| { kind: "busy" };

export type ThreadFailure =
	| CommentsFailure
	| { kind: "thread-not-found" }
	| { kind: "thread-full" }
	| { kind: "message-not-found" }
	| { kind: "not-editable" }
	| { kind: "invalid-input"; message: string };

export type ListCommentsResult =
	| { kind: "ok"; threads: CommentThread[]; diagnostics: CommentDiagnostic[] }
	| { kind: "not-found"; message: string };

export type WriteCommentsResult = { kind: "ok"; threads: CommentThread[] } | ThreadFailure;

type Abort = Exclude<ThreadFailure, { kind: "not-found" | "too-large" | "busy" | "invalid-input" }>;

function generateId(taken: ReadonlySet<string>): string {
	for (;;) {
		const id = randomBytes(6).toString("base64url");
		if (!taken.has(id)) return id;
	}
}

/** The failure for a message body that is blank or too long, else undefined. */
function invalidBody(body: string): { kind: "invalid-input"; message: string } | undefined {
	if (body.trim() === "") return { kind: "invalid-input", message: "A comment cannot be empty" };
	if (body.length > MAX_MESSAGE_BODY)
		return {
			kind: "invalid-input",
			message: `A comment cannot exceed ${MAX_MESSAGE_BODY} characters`,
		};
	return undefined;
}

function takeLast(text: string, limit: number): string {
	const chars = Array.from(text);
	return chars.length > limit ? chars.slice(chars.length - limit).join("") : text;
}

/**
 * Comment threads stored in a doc's frontmatter. Stateless: the per-file save
 * lock lives in `DocsService`, which does the actual file work.
 */
export class CommentsService {
	constructor(private readonly docs: DocsService) {}

	async list(path: string, publicOnly: boolean): Promise<ListCommentsResult> {
		const read = await this.docs.readSource(path, publicOnly);
		if (read.kind === "not-found") return read;
		if (read.kind === "too-large") return { kind: "ok", threads: [], diagnostics: [] };
		const { threads, diagnostics } = parseComments(read.source.text);
		return { kind: "ok", threads, diagnostics };
	}

	async addThread(input: {
		path: string;
		anchor: { heading: string | null; block: string; quote: string };
		body: string;
	}): Promise<WriteCommentsResult> {
		const invalid = invalidBody(input.body);
		if (invalid) return invalid;
		const anchor: CommentAnchor = {
			heading: input.anchor.heading === null ? null : normalizeText(input.anchor.heading),
			block: takeLast(normalizeText(input.anchor.block), MAX_ANCHOR_TEXT),
			quote: normalizeText(input.anchor.quote).slice(0, MAX_ANCHOR_TEXT),
		};
		if (anchor.block === "" || anchor.quote === "")
			return { kind: "invalid-input", message: "A comment must be anchored to some text" };
		return this.write(input.path, (yaml) => {
			const taken = new Set(parseCommentsYaml(yaml ?? "").threads.map((thread) => thread.id));
			return {
				kind: "add-thread",
				thread: {
					id: generateId(taken),
					anchor,
					resolved: false,
					messages: [
						{
							id: generateId(new Set()),
							author: "human",
							body: input.body,
							createdAt: new Date().toISOString(),
						},
					],
				},
			};
		});
	}

	async addReply(input: {
		path: string;
		threadId: string;
		body: string;
	}): Promise<WriteCommentsResult> {
		const invalid = invalidBody(input.body);
		if (invalid) return invalid;
		return this.write(input.path, (yaml) => {
			const thread = parseCommentsYaml(yaml ?? "").threads.find(
				(candidate) => candidate.id === input.threadId,
			);
			const taken = new Set(thread?.messages.map((message) => message.id));
			return {
				kind: "add-message",
				threadId: input.threadId,
				message: {
					id: generateId(taken),
					author: "human",
					body: input.body,
					createdAt: new Date().toISOString(),
				},
			};
		});
	}

	async editMessage(input: {
		path: string;
		threadId: string;
		messageId: string;
		body: string;
	}): Promise<WriteCommentsResult> {
		const invalid = invalidBody(input.body);
		if (invalid) return invalid;
		return this.write(input.path, () => ({
			kind: "edit-message",
			threadId: input.threadId,
			messageId: input.messageId,
			body: input.body,
			editedAt: new Date().toISOString(),
		}));
	}

	async setResolved(input: {
		path: string;
		threadId: string;
		resolved: boolean;
	}): Promise<WriteCommentsResult> {
		return this.write(input.path, () => ({
			kind: "set-resolved",
			threadId: input.threadId,
			resolved: input.resolved,
		}));
	}

	private async write(
		path: string,
		makeEdit: (yaml: string | undefined) => CommentsEdit,
	): Promise<WriteCommentsResult> {
		const result = await this.docs.updateFrontmatter<Abort>({
			path,
			update: (yaml) => {
				const edited = editComments(yaml, makeEdit(yaml));
				if (edited.kind === "ok") return { kind: "write", yaml: edited.yaml };
				return { kind: "abort", value: edited };
			},
		});
		switch (result.kind) {
			case "ok":
				return { kind: "ok", threads: parseComments(result.source).threads };
			case "aborted":
				return result.value;
			case "not-found":
			case "too-large":
			case "busy":
				return result;
			default: {
				const exhaustive: never = result;
				throw new Error(`Unhandled updateFrontmatter result: ${JSON.stringify(exhaustive)}`);
			}
		}
	}
}
