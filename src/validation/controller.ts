import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedure } from "../api/trpc.js";
import { ValidationService } from "./service.js";

// A single path string, nothing more — no batching like moveDocsToTrash,
// since validation is a per-doc, agent-in-the-loop check.
export const validateDocInput = z.object({ path: z.string().min(1).max(4096) });

// src/mcp/tools/validate-doc.ts reuses this shape as its validate_doc output
// so they can't drift.
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

const validateDoc = procedure(
	"Validates one .md/.mdx file: MDX compile errors, unknown components/props against the builtin registry, and — for same-machine callers only — a server-side render to catch render-time throws. Used by the MCP validate_doc tool.",
)
	.input(validateDocInput)
	.output(validationResultSchema)
	.mutation(async ({ ctx, input }) => {
		const outcome = await new ValidationService(
			ctx.rootInfos,
			ctx.registry,
			ctx.render,
		).validateDoc({ path: input.path, allowRender: ctx.isLoopback });
		switch (outcome.kind) {
			case "not-found":
				throw new TRPCError({ code: "NOT_FOUND", message: outcome.message });
			case "unreadable":
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: outcome.message });
			case "ok":
				return outcome.result;
			default: {
				const exhaustiveOutcome: never = outcome;
				throw new Error(`Unhandled validateDoc outcome: ${JSON.stringify(exhaustiveOutcome)}`);
			}
		}
	});

export const validationController = { validateDoc };

export type ValidateDocInput = z.infer<typeof validateDocInput>;
