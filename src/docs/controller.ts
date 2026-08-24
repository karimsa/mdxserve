import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedure } from "../api/trpc.js";

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

const getDocSource = procedure(
	"Returns the raw on-disk text of one .md/.mdx doc together with its mtime, so the in-place section editor can seed itself from exactly what is on disk (not the compiled module) and later detect concurrent edits. Used by the section editor when a section is opened.",
)
	.input(getDocSourceInput)
	.output(docSourceSchema)
	.query(async ({ ctx, input }) => {
		const result = await ctx.docs.readSource(input.path);
		switch (result.kind) {
			case "ok":
				return result.source;
			case "not-found":
				throw new TRPCError({ code: "NOT_FOUND", message: result.message });
			case "too-large":
				throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "File too large to edit" });
			default: {
				const exhaustiveResult: never = result;
				throw new Error(`Unhandled readSource result: ${JSON.stringify(exhaustiveResult)}`);
			}
		}
	});

const saveDocSection = procedure(
	"Replaces one line range of a doc with edited markdown: the mtime must still match the one the caller read (otherwise CONFLICT), the resulting file must validate (otherwise UNPROCESSABLE_CONTENT), and the write is atomic. Used by the in-place section editor's Save.",
)
	.input(saveDocSectionInput)
	.output(saveDocSectionResultSchema)
	.mutation(async ({ ctx, input }) => {
		const result = await ctx.docs.saveSection({
			path: input.path,
			startLine: input.startLine,
			endLine: input.endLine,
			mtime: input.mtime,
			markdown: input.markdown,
		});
		switch (result.kind) {
			case "ok":
				return { mtime: result.mtime };
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
				throw new Error(`Unhandled saveSection result: ${JSON.stringify(exhaustiveResult)}`);
			}
		}
	});

export const docsController = { getDocSource, saveDocSection };

export type GetDocSourceInput = z.infer<typeof getDocSourceInput>;
export type DocSourceOutput = z.infer<typeof docSourceSchema>;
export type SaveDocSectionInput = z.infer<typeof saveDocSectionInput>;
export type SaveDocSectionResult = z.infer<typeof saveDocSectionResultSchema>;
