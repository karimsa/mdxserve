import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedure } from "../api/trpc.js";
import { ValidationService } from "./service.js";
import { DIAGNOSTIC_CODES } from "./validate.js";

// A single path string, nothing more — no batching like moveDocsToTrash,
// since validation is a per-doc, agent-in-the-loop check.
const validateDocInput = z.object({ path: z.string().min(1).max(4096) });

// The codes come from DIAGNOSTIC_CODES, the list the validator's own type is
// built from, so the schema and the type cannot drift.
const diagnosticSchema = z.object({
	severity: z.enum(["error", "warning"]),
	code: z.enum(DIAGNOSTIC_CODES),
	message: z.string(),
	line: z.number().optional(),
	column: z.number().optional(),
	endLine: z.number().optional(),
	endColumn: z.number().optional(),
	component: z.string().optional(),
	prop: z.string().optional(),
	suggestions: z.array(z.string()).optional(),
});

/** @internal Exported for its tests. */
export const validationResultSchema = z.object({
	ok: z.boolean(),
	path: z.string(),
	diagnostics: z.array(diagnosticSchema),
	/** Advisory guidance for the agent — not errors, never affects `ok`. */
	hints: z.array(z.string()),
});

const validateDoc = procedure(
	"Validates one .md/.mdx file with the same parse that builds the document tree: syntax errors per section, the document language rules, builtin component names, prop names and prop values against each builtin's schema, the `id` rules for stateful builtins and headings, mermaid fences that draw charts (pie, xychart-beta, quadrantChart, sankey-beta — use <Chart> instead). Also returns `hints`: advisory guidance that never affects `ok`, e.g. a Markdown image that looks like a screenshot and would read better as the <Screenshot> builtin. Used by `mdxserve validate`.",
)
	.input(validateDocInput)
	.output(validationResultSchema)
	.mutation(async ({ ctx, input }) => {
		const outcome = await new ValidationService(ctx.rootInfos, ctx.registry, ctx.docs).validateDoc({
			path: input.path,
		});
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
