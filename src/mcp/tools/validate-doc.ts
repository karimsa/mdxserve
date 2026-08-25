import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDocPath } from "../../roots/paths.js";
import { ValidationService } from "../../validation/service.js";
import { validationResultSchema } from "../../validation/controller.js";
import type { McpContext } from "../server.js";
import { mountedRoots } from "../mounted-roots.js";
import { errorResult, textResult, formatValidationResult, NO_ROOTS_MESSAGE } from "../format.js";

const validateDocInput = { path: z.string().min(1) };

// Kept in lockstep with the `validateDoc` tRPC procedure's output — importing
// its zod shape (rather than a hand-copied one) means the two can't drift.
const validateDocOutput = validationResultSchema.shape;

export function registerValidateDoc(server: McpServer, ctx: McpContext): void {
	const { registry, render, remote, allowRender } = ctx;

	server.registerTool(
		"validate_doc",
		{
			title: "Validate a doc",
			description:
				"Validate a Markdown/MDX file under the served roots: MDX compile errors, unknown components, and unknown props against the builtin component registry, plus a server-side render of the doc to catch errors that only throw once React actually renders it (reported as a render-error diagnostic). Call this after writing or editing a .md/.mdx file to catch mistakes before a human sees them rendered. The `rendered` field on the result is true only when the render step actually ran — it stays false when no mdxserve server is available to render with, in which case only the static checks apply. Errors thrown inside a useEffect/useLayoutEffect, and hydration mismatches, are never caught by this tool even when rendered is true — those are browser-only. Pass the absolute path (the same form the site uses in its URLs), or a path relative to a served root when only one root contains it.",
			inputSchema: validateDocInput,
			outputSchema: validateDocOutput,
		},
		async ({ path: docPath }) => {
			const mounted = await mountedRoots(ctx);
			if (mounted.kind === "error") return errorResult(mounted.message);
			// An absolute path needs no root to resolve against, so the static
			// checks still run with no server (or no roots) at all.
			const roots = mounted.kind === "ok" ? mounted.roots : [];
			const rootDirs = roots.map((rootInfo) => rootInfo.dir);
			if (!path.isAbsolute(docPath)) {
				if (mounted.kind === "no-server") {
					return errorResult(`${mounted.message}, or pass an absolute path`);
				}
				if (roots.length === 0) {
					return errorResult(`${NO_ROOTS_MESSAGE}, or pass an absolute path`);
				}
			}

			if (remote) {
				const resolved = await resolveDocPath(rootDirs, docPath);
				if (!resolved.ok) return errorResult(resolved.error);
				const remoteOutcome = await remote.validateDoc(resolved.abs);
				if (remoteOutcome.kind === "ok") {
					return textResult(formatValidationResult(remoteOutcome.value), {
						...remoteOutcome.value,
					});
				}
				if (remoteOutcome.kind === "error") return errorResult(remoteOutcome.message);
				// unavailable: fall through to the local, static-only path below.
			}

			// `allowRender` comes straight from the context: the HTTP adapter sets
			// it to whether this caller is on loopback, and the stdio bridge
			// leaves it unset, which defaults to false here — same fail-closed
			// posture as ValidationService itself.
			const outcome = await new ValidationService(roots, registry, render).validateDoc({
				path: docPath,
				allowRender: allowRender ?? false,
			});
			switch (outcome.kind) {
				case "not-found":
					return errorResult(outcome.message);
				case "unreadable":
					return errorResult(outcome.message);
				case "ok":
					return textResult(formatValidationResult(outcome.result), { ...outcome.result });
				default: {
					const exhaustiveOutcome: never = outcome;
					throw new Error(`Unhandled validateDoc outcome: ${JSON.stringify(exhaustiveOutcome)}`);
				}
			}
		},
	);
}
