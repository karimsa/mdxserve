import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedure } from "../api/trpc.js";
import { ValidationService } from "./service.js";

// A single path string, nothing more — no batching like moveDocsToTrash,
// since validation is a per-doc, agent-in-the-loop check.
export const validateDocInput = z.object({ path: z.string().min(1).max(4096) });

// src/cli/validate.ts reuses this shape for its `--json` output so they can't
// drift.
export const diagnosticSchema = z.object({
	severity: z.enum(["error", "warning"]),
	code: z.enum([
		"mdx-syntax",
		"esm-not-supported",
		"non-literal-expression",
		"unknown-component",
		"removed-component",
		"unsupported-element",
		"unsupported-attribute",
		"invalid-href",
		"unknown-prop",
		"invalid-prop",
		"missing-id",
		"invalid-id",
		"duplicate-id",
		"id-conflicts-with-heading",
		"duplicate-heading",
		"duplicate-tab-value",
		"invalid-tab-default",
		"render-error",
		"mermaid-chart",
		"frontmatter-metadata",
		"frontmatter-comments",
		"comment-anchor",
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
	/** Advisory guidance for the agent — not errors, never affects `ok`. */
	hints: z.array(z.string()),
});

const validateDoc = procedure(
	"Validates one .md/.mdx file with the same parse that builds the document tree: syntax errors per section, the document language rules, builtin component names, prop names and prop values against each builtin's schema, the `id` rules for stateful builtins and headings, mermaid fences that draw charts (pie, xychart-beta, quadrantChart, sankey-beta — use <Chart> instead), and — for same-machine callers only — a server-side render to catch render-time throws. Also returns `hints`: advisory guidance that never affects `ok`, e.g. a Markdown image that looks like a screenshot and would read better as the <Screenshot> builtin. Used by `mdxserve validate`.",
)
	.input(validateDocInput)
	.output(validationResultSchema)
	.mutation(async ({ ctx, input }) => {
		const outcome = await new ValidationService(
			ctx.rootInfos,
			ctx.registry,
			ctx.docs,
			ctx.render,
		).validateDoc({
			path: input.path,
			allowRender: ctx.isLoopback && ctx.permissions !== "restricted",
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

export type ValidateDocInput = z.infer<typeof validateDocInput>;
