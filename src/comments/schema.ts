import { z } from "zod";
import { normalizeText } from "./anchor.js";

export const MAX_ANCHOR_TEXT = 500;
export const MAX_ANCHOR_HEADING = 300;
export const MAX_MESSAGE_BODY = 4000;
export const MAX_MESSAGES_PER_THREAD = 100;

export const COMMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const idSchema = z.string().regex(COMMENT_ID_PATTERN);
const timestampSchema = z.iso.datetime({ offset: true });

export const commentAnchorSchema = z.object({
	/** Normalized text of the nearest heading, or null before the first heading. */
	heading: z.string().min(1).max(MAX_ANCHOR_HEADING).nullable(),
	/** The last 500 characters of the block's normalized rendered text. */
	block: z.string().min(1).max(MAX_ANCHOR_TEXT),
	/** The highlighted text, normalized. */
	quote: z.string().min(1).max(MAX_ANCHOR_TEXT),
});

export const commentAuthorSchema = z.enum(["human", "agent"]);

export const commentMessageSchema = z.object({
	id: idSchema,
	author: commentAuthorSchema,
	body: z.string().min(1).max(MAX_MESSAGE_BODY),
	createdAt: timestampSchema.optional(),
	editedAt: timestampSchema.optional(),
});

export const commentThreadSchema = z.object({
	id: idSchema,
	anchor: commentAnchorSchema,
	resolved: z.boolean().default(false),
	messages: z.array(commentMessageSchema).min(1).max(MAX_MESSAGES_PER_THREAD),
});

export const commentDiagnosticSchema = z.object({
	severity: z.literal("warning"),
	code: z.literal("frontmatter-comments"),
	message: z.string(),
	line: z.number().int().optional(),
	column: z.number().int().optional(),
});

/** An anchor as sent by a caller: limits are checked on the raw text, and it must not be blank. */
const nonBlank = (value: string) => normalizeText(value).length > 0;
export const commentAnchorInputSchema = z.object({
	heading: z
		.string()
		.max(MAX_ANCHOR_HEADING)
		.refine(nonBlank, "Heading must not be blank")
		.nullable(),
	block: z.string().min(1).max(MAX_ANCHOR_TEXT).refine(nonBlank, "Block must not be blank"),
	quote: z.string().min(1).max(MAX_ANCHOR_TEXT).refine(nonBlank, "Quote must not be blank"),
});

export const commentBodyInputSchema = z
	.string()
	.min(1)
	.max(MAX_MESSAGE_BODY)
	.refine(nonBlank, "Comment must not be blank");

export type CommentAnchor = z.infer<typeof commentAnchorSchema>;
export type CommentAuthor = z.infer<typeof commentAuthorSchema>;
export type CommentMessage = z.infer<typeof commentMessageSchema>;
export type CommentThread = z.infer<typeof commentThreadSchema>;
export type CommentDiagnostic = z.infer<typeof commentDiagnosticSchema>;
export type CommentAnchorInput = z.infer<typeof commentAnchorInputSchema>;
