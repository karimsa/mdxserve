import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedure, requireLoopback } from "../api/trpc.js";
import { ExportService, EXPORT_FORMATS, MERMAID_MODES } from "./service.js";

export const exportDocInput = z.object({
	/** Absolute path of the doc (the same form the site uses in its URLs), or root-relative. */
	path: z.string().min(1).max(4096),
	format: z.enum(EXPORT_FORMATS).default("html"),
	mermaid: z.enum(MERMAID_MODES).default("cdn"),
});

export const exportDocResultSchema = z.object({
	fileName: z.string(),
	contents: z.string(),
	encoding: z.enum(["utf8", "base64"]),
	bytes: z.number().int().nonnegative(),
	warnings: z.array(z.string()),
	mermaid: z.enum(MERMAID_MODES),
});

const exportDoc = procedure(
	"Builds one .md/.mdx doc under a mounted root into a single self-contained file and returns its bytes for the browser to save; the mermaid mode is forced to none when the doc has no mermaid fence. Same-machine callers only. Used by the viewer's Export dialog.",
)
	.use(requireLoopback)
	.input(exportDocInput)
	.output(exportDocResultSchema)
	.mutation(async ({ ctx, input }) => {
		const service = new ExportService(
			ctx.bundle,
			ctx.rootInfos.map((rootInfo) => rootInfo.dir),
		);
		const result = await service.build({
			docPath: input.path,
			format: input.format,
			mermaid: input.mermaid,
		});
		switch (result.kind) {
			case "ok":
				return {
					fileName: result.fileName,
					contents: result.contents,
					encoding: result.encoding,
					bytes: result.bytes,
					warnings: result.warnings,
					mermaid: result.mermaid,
				};
			case "not-found":
				throw new TRPCError({ code: "NOT_FOUND", message: result.message });
			case "not-a-doc":
			case "unsupported-format":
				throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
			case "bundle-failed":
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.message });
			default: {
				const exhaustiveResult: never = result;
				throw new Error(`Unhandled build result: ${JSON.stringify(exhaustiveResult)}`);
			}
		}
	});

export const exportController = { exportDoc };

export type ExportDocInput = z.infer<typeof exportDocInput>;
export type ExportDocResult = z.infer<typeof exportDocResultSchema>;
