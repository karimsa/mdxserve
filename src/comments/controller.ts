import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedure } from "../api/trpc.js";
import { CommentsService, type ThreadFailure } from "./service.js";
import {
	COMMENT_ID_PATTERN,
	commentAnchorInputSchema,
	commentBodyInputSchema,
	commentDiagnosticSchema,
	commentThreadSchema,
} from "./schema.js";

export * from "./schema.js";

const pathSchema = z.string().min(1).max(4096);
const idSchema = z.string().regex(COMMENT_ID_PATTERN);

export const getDocCommentsInput = z.object({ path: pathSchema });
export const getDocCommentsResultSchema = z.object({
	threads: z.array(commentThreadSchema),
	diagnostics: z.array(commentDiagnosticSchema),
});

export const addCommentThreadInput = z.object({
	path: pathSchema,
	anchor: commentAnchorInputSchema,
	body: commentBodyInputSchema,
});
export const addCommentReplyInput = z.object({
	path: pathSchema,
	threadId: idSchema,
	body: commentBodyInputSchema,
});
export const editCommentInput = z.object({
	path: pathSchema,
	threadId: idSchema,
	messageId: idSchema,
	body: commentBodyInputSchema,
});
export const setCommentThreadResolvedInput = z.object({
	path: pathSchema,
	threadId: idSchema,
	resolved: z.boolean(),
});
export const commentThreadsResultSchema = z.object({ threads: z.array(commentThreadSchema) });

function throwFailure(failure: ThreadFailure): never {
	switch (failure.kind) {
		case "not-found":
			throw new TRPCError({ code: "NOT_FOUND", message: failure.message });
		case "thread-not-found":
			throw new TRPCError({ code: "NOT_FOUND", message: "Comment thread not found" });
		case "thread-full":
			throw new TRPCError({
				code: "PAYLOAD_TOO_LARGE",
				message: "This thread has reached its 100-message limit",
			});
		case "message-not-found":
			throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found" });
		case "not-editable":
			throw new TRPCError({ code: "FORBIDDEN", message: "Only human comments can be edited" });
		case "invalid-frontmatter":
			throw new TRPCError({
				code: "UNPROCESSABLE_CONTENT",
				message: `The doc's frontmatter is not valid: ${failure.message}`,
			});
		case "too-large":
			throw new TRPCError({
				code: "PAYLOAD_TOO_LARGE",
				message: "The doc's frontmatter would exceed 64 KiB",
			});
		case "invalid-input":
			throw new TRPCError({ code: "BAD_REQUEST", message: failure.message });
		case "busy":
			throw new TRPCError({ code: "CONFLICT", message: "File is changing on disk; try again" });
		default: {
			const exhaustive: never = failure;
			throw new Error(`Unhandled comments result: ${JSON.stringify(exhaustive)}`);
		}
	}
}

const getDocComments = procedure(
	"Returns the comment threads stored in a doc's frontmatter, plus warnings for malformed entries that were skipped. Readable on restricted servers. Used by the comments panel and highlights.",
)
	.input(getDocCommentsInput)
	.output(getDocCommentsResultSchema)
	.query(async ({ ctx, input }) => {
		const result = await new CommentsService(ctx.docs).list(
			input.path,
			ctx.permissions === "restricted",
		);
		if (result.kind === "ok") return { threads: result.threads, diagnostics: result.diagnostics };
		return throwFailure(result);
	});

const addCommentThread = procedure(
	"Starts a comment thread on a piece of rendered text by writing it, with its first human message, into the doc's frontmatter. Returns the doc's full thread list. Used by the comment composer.",
)
	.input(addCommentThreadInput)
	.output(commentThreadsResultSchema)
	.mutation(async ({ ctx, input }) => {
		const result = await new CommentsService(ctx.docs).addThread(input);
		if (result.kind === "ok") return { threads: result.threads };
		return throwFailure(result);
	});

const addCommentReply = procedure(
	"Appends a human reply to an existing comment thread in the doc's frontmatter. Returns the doc's full thread list. Used by a thread's reply box.",
)
	.input(addCommentReplyInput)
	.output(commentThreadsResultSchema)
	.mutation(async ({ ctx, input }) => {
		const result = await new CommentsService(ctx.docs).addReply(input);
		if (result.kind === "ok") return { threads: result.threads };
		return throwFailure(result);
	});

const editComment = procedure(
	"Changes the text of a human-written comment message (agent messages are refused with FORBIDDEN). Returns the doc's full thread list. Used by a message's Edit action.",
)
	.input(editCommentInput)
	.output(commentThreadsResultSchema)
	.mutation(async ({ ctx, input }) => {
		const result = await new CommentsService(ctx.docs).editMessage(input);
		if (result.kind === "ok") return { threads: result.threads };
		return throwFailure(result);
	});

const setCommentThreadResolved = procedure(
	"Marks a whole comment thread resolved or reopens it. Returns the doc's full thread list. Used by a thread's Resolve and Reopen buttons.",
)
	.input(setCommentThreadResolvedInput)
	.output(commentThreadsResultSchema)
	.mutation(async ({ ctx, input }) => {
		const result = await new CommentsService(ctx.docs).setResolved(input);
		if (result.kind === "ok") return { threads: result.threads };
		return throwFailure(result);
	});

export const commentsController = {
	getDocComments,
	addCommentThread,
	addCommentReply,
	editComment,
	setCommentThreadResolved,
};

export type GetDocCommentsInput = z.infer<typeof getDocCommentsInput>;
export type GetDocCommentsResult = z.infer<typeof getDocCommentsResultSchema>;
export type AddCommentThreadInput = z.infer<typeof addCommentThreadInput>;
export type AddCommentReplyInput = z.infer<typeof addCommentReplyInput>;
export type EditCommentInput = z.infer<typeof editCommentInput>;
export type SetCommentThreadResolvedInput = z.infer<typeof setCommentThreadResolvedInput>;
export type CommentThreadsResult = z.infer<typeof commentThreadsResultSchema>;
