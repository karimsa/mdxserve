import { z } from "zod";
import type { TreeNode } from "../listing.js";

const listingEntrySchema = z.object({
	name: z.string(),
	isDir: z.boolean(),
	isDoc: z.boolean(),
	/** Plain-text first h1 of the doc, when it has one. */
	title: z.string().optional(),
	/** The same h1 as inline HTML, for display. */
	titleHtml: z.string().optional(),
	size: z.number().optional(),
	/** Last modified time, epoch milliseconds. */
	mtime: z.number().optional(),
});

export const getFolderListingInput = z.object({ path: z.string() });

// No `kind` field on the wire: output parsers strip unknown keys, and
// `readListing`'s `kind: "listing"` is a client-side Route discriminator, not
// part of the folder listing data itself.
export const folderListingSchema = z.object({
	path: z.string(),
	rootName: z.string(),
	rootDir: z.string(),
	entries: z.array(listingEntrySchema),
});

export const getDocTreeInput = z.object({
	path: z.string().optional(),
	maxDepth: z.number().int().min(1).max(8).default(8),
});

// Recursive schema via zod 4 getter syntax: `children` refers back to
// `treeNodeSchema` itself, so the reference must be lazy.
export const treeNodeSchema: z.ZodType<TreeNode> = z.object({
	name: z.string(),
	/** Absolute filesystem path; directories end in "/". */
	path: z.string(),
	isDir: z.boolean(),
	isDoc: z.boolean(),
	/** Last modified time, epoch milliseconds. */
	mtime: z.number().optional(),
	get children() {
		return z.array(treeNodeSchema).optional();
	},
});

export const docTreeSchema = z.object({
	roots: z.array(
		z.object({
			name: z.string(),
			dir: z.string(),
			nodes: z.array(treeNodeSchema),
		}),
	),
});

export const searchDocsInput = z.object({ query: z.string() });

// Matches src/search.ts's SearchResult, plus `score` from the MiniSearch hit
// so the stdio bridge can merge results across servers.
export const searchResultSchema = z.object({
	path: z.string(),
	/** Display label: `"<rootName>/<relative path>"`. */
	label: z.string(),
	title: z.string(),
	excerpt: z.string(),
	/** Query terms MiniSearch matched for this hit, for client-side highlighting. */
	terms: z.array(z.string()),
	score: z.number(),
});

export const searchDocsResultSchema = z.object({ results: z.array(searchResultSchema) });

export const moveDocsToTrashInput = z.object({
	paths: z.array(z.string().min(1)).min(1).max(500),
});

export const moveDocsToTrashResultSchema = z.object({
	deleted: z.array(z.string()),
	failed: z.array(z.object({ path: z.string(), error: z.string() })),
});

// A single path string, nothing more — no batching like moveDocsToTrash,
// since validation is a per-doc, agent-in-the-loop check.
export const validateDocInput = z.object({ path: z.string().min(1).max(4096) });

// Copied from src/mcp.ts:69-93 — keep this shape identical so src/mcp.ts can
// import these instead of maintaining its own copy.
export const diagnosticSchema = z.object({
	severity: z.enum(["error", "warning"]),
	code: z.enum([
		"mdx-compile",
		"unknown-component",
		"unknown-prop",
		"unresolved-import",
		"render-error",
	]),
	message: z.string(),
	line: z.number().optional(),
	column: z.number().optional(),
	endLine: z.number().optional(),
	endColumn: z.number().optional(),
	component: z.string().optional(),
	prop: z.string().optional(),
	suggestions: z.array(z.string()).optional(),
});

export const validationResultSchema = z.object({
	ok: z.boolean(),
	path: z.string(),
	diagnostics: z.array(diagnosticSchema),
	/** Whether the render step actually ran (a `render` was given and no static error existed). */
	rendered: z.boolean(),
});

export const getDocSourceInput = z.object({ path: z.string().min(1).max(4096) });

export const docSourceSchema = z.object({
	/** The raw on-disk text, not the compiled module. */
	text: z.string(),
	/** mtime (epoch ms) at the moment `text` was read; echoed back to `saveDocSection`. */
	mtime: z.number(),
});

// markdown is capped well below the adapter's body cap so the 413/400
// distinction is meaningful: a body that's merely oversized because of a
// huge `markdown` field fails schema validation (400) rather than the
// coarser byte-count check (413).
export const saveDocSectionInput = z.object({
	path: z.string().min(1).max(4096),
	startLine: z.number().int().positive(),
	endLine: z.number().int().positive(),
	mtime: z.number(),
	markdown: z.string().max(256 * 1024),
});

export const saveDocSectionResultSchema = z.object({
	/** The file's mtime after the write, for the next save from the same editor. */
	mtime: z.number(),
});

export type GetFolderListingInput = z.infer<typeof getFolderListingInput>;
export type FolderListing = z.infer<typeof folderListingSchema>;
export type GetDocTreeInput = z.infer<typeof getDocTreeInput>;
export type DocTree = z.infer<typeof docTreeSchema>;
export type SearchDocsInput = z.infer<typeof searchDocsInput>;
export type SearchResultOutput = z.infer<typeof searchResultSchema>;
export type SearchDocsResult = z.infer<typeof searchDocsResultSchema>;
export type MoveDocsToTrashInput = z.infer<typeof moveDocsToTrashInput>;
export type MoveDocsToTrashResult = z.infer<typeof moveDocsToTrashResultSchema>;
export type ValidateDocInput = z.infer<typeof validateDocInput>;
export type GetDocSourceInput = z.infer<typeof getDocSourceInput>;
export type DocSourceOutput = z.infer<typeof docSourceSchema>;
export type SaveDocSectionInput = z.infer<typeof saveDocSectionInput>;
export type SaveDocSectionResult = z.infer<typeof saveDocSectionResultSchema>;
