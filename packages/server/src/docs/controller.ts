import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedure } from "../api/trpc.js";
import { documentTreeSchema } from "../document/schema.js";

const getNodeSourceInput = z.object({
	path: z.string().min(1).max(4096),
	/** A node ID from the `getDocument` tree: a section, a tab, a mermaid block, a builtin block. */
	id: z.string().min(1).max(1024),
});

const nodeSourceSchema = z.object({
	/** The node's own source lines, ready to seed an editor. */
	markdown: z.string(),
	/** The version token of the bytes `markdown` was read from; echoed back to `saveDocNode`. */
	version: z.string(),
});

// markdown is capped well below the adapter's body cap so the 413/400
// distinction is meaningful: a body that's merely oversized because of a
// huge `markdown` field fails schema validation (400) rather than the
// coarser byte-count check (413).
const saveDocNodeInput = z.object({
	path: z.string().min(1).max(4096),
	id: z.string().min(1).max(1024),
	/** The `version` from the `getNodeSource` (or `getDocument`) this edit was seeded from. */
	version: z.string().min(1).max(128),
	markdown: z.string().max(256 * 1024),
});

const saveDocNodeResultSchema = z.object({
	/** The file's version after the write, for the next save from the same editor. */
	version: z.string(),
});

const getDocumentInput = z.object({ path: z.string().min(1).max(4096) });

export const documentResultSchema = z.object({
	/** The parsed document: what a client renders, with no executable content. */
	document: documentTreeSchema,
	/** The same version token `getNodeSource` returns for these bytes. */
	version: z.string(),
});

const getDocument = procedure(
	"Returns one .md/.mdx doc parsed into its JSON document tree (schema version, metadata, table of contents, and block and inline nodes with stable ids) together with the version token of the bytes it was parsed from. Nothing in it is executable, so any caller may read it; restricted mode applies the same path rules as every other doc read. Used by clients that render documents from JSON and by `mdxserve document`.",
)
	.input(getDocumentInput)
	.output(documentResultSchema)
	.query(async ({ ctx, input }) => {
		const result = await ctx.docs.readDocument(input.path, ctx.permissions === "restricted");
		switch (result.kind) {
			case "ok":
				return { document: result.document, version: result.version };
			case "not-found":
				throw new TRPCError({ code: "NOT_FOUND", message: result.message });
			case "too-large":
				throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "File too large to parse" });
			default: {
				const exhaustiveResult: never = result;
				throw new Error(`Unhandled readDocument result: ${JSON.stringify(exhaustiveResult)}`);
			}
		}
	});

const getNodeSource = procedure(
	"Returns the source lines of one node of a doc, found by its ID in the getDocument tree (a section, a tab, a mermaid diagram or a builtin block), with the version token of the bytes they were read from. Restricted mode applies the same path rules as getDocument. Used by the section, diagram and builtin block editors in the document view when an editor is opened.",
)
	.input(getNodeSourceInput)
	.output(nodeSourceSchema)
	.query(async ({ ctx, input }) => {
		const result = await ctx.docs.readNodeSource(
			input.path,
			input.id,
			ctx.permissions === "restricted",
		);
		switch (result.kind) {
			case "ok":
				return { markdown: result.markdown, version: result.version };
			case "not-found":
				throw new TRPCError({ code: "NOT_FOUND", message: result.message });
			case "too-large":
				throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "File too large to edit" });
			default: {
				const exhaustiveResult: never = result;
				throw new Error(`Unhandled readNodeSource result: ${JSON.stringify(exhaustiveResult)}`);
			}
		}
	});

const saveDocNode = procedure(
	"Replaces the source lines of one node of a doc, found by its ID, with edited markdown: the file must still hash to the version the caller read (otherwise CONFLICT), the node must exist (otherwise NOT_FOUND), the edit must not introduce a validation error the file did not already have (otherwise UNPROCESSABLE_CONTENT), and the write is atomic. Used by the section, diagram and builtin block editors in the document view when they save.",
)
	.input(saveDocNodeInput)
	.output(saveDocNodeResultSchema)
	.mutation(async ({ ctx, input }) => {
		const result = await ctx.docs.saveNode({
			path: input.path,
			id: input.id,
			version: input.version,
			markdown: input.markdown,
		});
		switch (result.kind) {
			case "ok":
				return { version: result.version };
			case "not-found":
				throw new TRPCError({ code: "NOT_FOUND", message: result.message });
			case "stale":
				throw new TRPCError({ code: "CONFLICT", message: "File changed on disk" });
			case "invalid-range":
				throw new TRPCError({ code: "CONFLICT", message: result.message });
			case "invalid-doc":
				throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: result.message });
			default: {
				const exhaustiveResult: never = result;
				throw new Error(`Unhandled saveNode result: ${JSON.stringify(exhaustiveResult)}`);
			}
		}
	});

export const docsController = { getDocument, getNodeSource, saveDocNode };
