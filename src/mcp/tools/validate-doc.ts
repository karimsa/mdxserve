import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDocPath } from "../../roots/paths.js";
import { ValidationService } from "../../validation/service.js";
import { validationResultSchema } from "../../validation/controller.js";
import type { McpContext } from "../server.js";
import { errorResult, textResult, formatValidationResult, NO_SERVER_MESSAGE } from "../format.js";

const validateDocInput = { path: z.string().min(1) };

// Kept in lockstep with the `validateDoc` tRPC procedure's output — importing
// its zod shape (rather than a hand-copied one) means the two can't drift.
const validateDocOutput = validationResultSchema.shape;

export function registerValidateDoc(server: McpServer, ctx: McpContext): void {
	const { getRoots, registry, render, remote, allowRender } = ctx;

	server.registerTool(
		"validate_doc",
		{
			title: "Validate a doc",
			description:
				"Validate a Markdown/MDX file under the served root: MDX compile errors, unknown components, and unknown props against the builtin component registry, plus a server-side render of the doc to catch errors that only throw once React actually renders it (reported as a render-error diagnostic). Call this after writing or editing a .md/.mdx file to catch mistakes before a human sees them rendered. The `rendered` field on the result is true only when the render step actually ran — it stays false when no mdxserve server is available to render with, in which case only the static checks apply. Errors thrown inside a useEffect/useLayoutEffect, and hydration mismatches, are never caught by this tool even when rendered is true — those are browser-only. Pass the absolute path (the same form the site uses in its URLs), or a path relative to a served root when only one root contains it.",
			inputSchema: validateDocInput,
			outputSchema: validateDocOutput,
		},
		async ({ path: docPath }) => {
			const roots = getRoots();
			const rootDirs = roots.map((rootInfo) => rootInfo.dir);
			if (roots.length === 0 && !path.isAbsolute(docPath)) {
				return errorResult(`${NO_SERVER_MESSAGE}, or pass an absolute path`);
			}

			if (remote) {
				const resolved = await resolveDocPath(rootDirs, docPath);
				if (!resolved.ok) return errorResult(resolved.error);
				const remoteResult = await remote.validateDoc(resolved.abs);
				if (remoteResult)
					return textResult(formatValidationResult(remoteResult), { ...remoteResult });
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
