import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readTree, type TreeNode } from "./listing.js";
import { search as searchDocs, type SearchResult } from "./search.js";
import { searchRegistry, formatComponent, suggest, type Registry } from "./registry.js";
import { resolveDirPath, resolveDocPath } from "./paths.js";
import type { RootInfo } from "./shell.js";
import { validateDocAt } from "./validate-doc.js";
import { validationResultSchema } from "./api/schemas.js";
import type { DocTree } from "./api/schemas.js";
import type { ValidationResult, Diagnostic } from "./validate.js";
import type { RenderOutcome } from "./render.js";

/** One entry of `getDocTree`'s output — reused so `list_docs` doesn't keep its own copy. */
export type DocTreeRoot = DocTree["roots"][number];

export type RemoteOutcome<T> =
	{ kind: "ok"; value: T } | { kind: "error"; message: string } | { kind: "unavailable" };

/**
 * Stdio mode only: proxies `validate_doc`/`search_docs`/`list_docs` to
 * whichever live `mdxserve serve` instance(s) actually own the relevant
 * path(s), over a tRPC client (see `src/remote.ts`), so the server's warm
 * search index and render worker are the single source of truth. `null` (for
 * `validateDoc`) or `{ kind: "unavailable" }` means no owning server, or the
 * request itself failed, and the caller falls back to local, static-only
 * handling.
 */
export interface RemoteDocs {
	validateDoc(absPath: string): Promise<ValidationResult | null>;
	searchDocs(query: string): Promise<RemoteOutcome<SearchResult[]>>;
	listDocs(dirPath: string | undefined, maxDepth: number): Promise<RemoteOutcome<DocTreeRoot[]>>;
}

export interface McpContext {
	/** Every currently-mounted root, in mount order. Called fresh per tool call. */
	getRoots: () => RootInfo[];
	registry: Registry;
	/** Renders a doc server-side (HTTP mode only, where a Vite dev server is live). */
	render?: (absPath: string) => Promise<RenderOutcome>;
	/**
	 * Stdio mode only (`mdxserve mcp`): a tRPC-backed proxy to whichever
	 * `mdxserve serve` instance(s) are live. Left undefined in HTTP mode
	 * (the in-process `/__mdxserve/mcp` route), which already has direct
	 * access to the registry and render worker it needs.
	 */
	remote?: RemoteDocs;
}

const NO_SERVER_MESSAGE = "No mdxserve server is running; start one with `mdxserve serve <dir>`";

const SERVER_VERSION = "0.1.0";

function formatDiagnostic(reportedPath: string, diagnostic: Diagnostic): string {
	const line = diagnostic.line ?? 0;
	const column = diagnostic.column ?? 0;
	const base = `${reportedPath}:${line}:${column}  ${diagnostic.severity}  ${diagnostic.code}  ${diagnostic.message}`;
	if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
		return `${base}\n    did you mean: ${diagnostic.suggestions.join(", ")}`;
	}
	return base;
}

function renderStatusLine(result: ValidationResult): string {
	if (result.rendered) return result.ok ? "Rendered OK" : "Rendered with errors";
	// `rendered: false` has three causes; don't blame a missing server for the
	// other two.
	if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
		return "Not rendered (fix the errors above first)";
	}
	return "Not rendered (no mdxserve server is running, or the caller is not on loopback)";
}

function formatValidationResult(result: ValidationResult): string {
	const lines = result.diagnostics.map((diagnostic) => formatDiagnostic(result.path, diagnostic));
	const renderLine = renderStatusLine(result);
	if (result.diagnostics.length === 0) return [`OK: ${result.path}`, renderLine].join("\n");
	// `ok` only means "no errors" — warnings still need to reach an agent that
	// reads the text rather than the structured output.
	if (result.ok) {
		const warningCount = result.diagnostics.length;
		return [
			`OK with ${warningCount} warning${warningCount === 1 ? "" : "s"}: ${result.path}`,
			...lines,
			renderLine,
		].join("\n");
	}
	return [...lines, renderLine].join("\n");
}

function formatSearchResults(query: string, results: SearchResult[]): string {
	return results.length === 0
		? `No docs match "${query}".`
		: results.map((result) => `${result.path} — ${result.title}\n    ${result.excerpt}`).join("\n");
}

function formatDocTree(roots: DocTreeRoot[], dirAbs: string | null): string {
	return roots
		.map((rootEntry) => {
			const body =
				rootEntry.nodes.length === 0 ? "  (no docs)" : indentTree(rootEntry.nodes, 1).join("\n");
			return `${rootEntry.name} (${dirAbs ?? rootEntry.dir})\n${body}`;
		})
		.join("\n\n");
}

const validateDocInput = { path: z.string().min(1) };

// Kept in lockstep with the `validateDoc` tRPC procedure's output — importing
// its zod shape (rather than a hand-copied one) means the two can't drift.
const validateDocOutput = validationResultSchema.shape;

const listComponentsInput = { query: z.string().optional() };

const listComponentsOutput = {
	components: z.array(
		z.object({
			name: z.string(),
			description: z.string(),
			whenToUse: z.string(),
			props: z.array(z.string()),
		}),
	),
};

const showComponentInput = { name: z.string().min(1) };

const showComponentOutput = { component: z.any() };

const searchDocsInput = { query: z.string() };

const searchDocsOutput = { results: z.array(z.any()) };

const listDocsInput = {
	path: z.string().optional(),
	maxDepth: z.number().int().min(1).max(8).default(8),
};

const listDocsOutput = {
	roots: z.array(z.object({ name: z.string(), dir: z.string(), nodes: z.array(z.any()) })),
};

function errorResult(text: string): { isError: true; content: [{ type: "text"; text: string }] } {
	return { isError: true, content: [{ type: "text", text }] };
}

function textResult<T extends object>(
	text: string,
	structuredContent: T,
): { content: [{ type: "text"; text: string }]; structuredContent: T } {
	return { content: [{ type: "text", text }], structuredContent };
}

function componentPropNames(props: Record<string, unknown>): string[] {
	return Object.keys((props?.properties as Record<string, unknown>) ?? {});
}

function indentTree(nodes: TreeNode[], depth = 0): string[] {
	const lines: string[] = [];
	for (const node of nodes) {
		lines.push(`${"  ".repeat(depth)}${node.isDir ? `${node.name}/` : node.name}`);
		if (node.children) lines.push(...indentTree(node.children, depth + 1));
	}
	return lines;
}

export function createMcpServer(ctx: McpContext): McpServer {
	const { getRoots, registry, render, remote } = ctx;

	const server = new McpServer({ name: "mdxserve", version: SERVER_VERSION });

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

			const resolved = await resolveDocPath(rootDirs, docPath);
			if (!resolved.ok) return errorResult(resolved.error);

			if (remote) {
				const remoteResult = await remote.validateDoc(resolved.abs);
				if (remoteResult)
					return textResult(formatValidationResult(remoteResult), { ...remoteResult });
			}

			let result: ValidationResult;
			try {
				result = await validateDocAt(resolved.abs, { registry, render });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return errorResult(`Failed to read ${resolved.abs}: ${message}`);
			}

			return textResult(formatValidationResult(result), { ...result });
		},
	);

	server.registerTool(
		"list_components",
		{
			title: "List builtin components",
			description:
				"List (optionally filtering by a case-insensitive substring match against name, description, whenToUse, and prop names) the builtin MDX components available to authors, e.g. Callout, Badge, Tabs. Call this to discover what components exist before writing or reviewing MDX.",
			inputSchema: listComponentsInput,
			outputSchema: listComponentsOutput,
		},
		async ({ query }) => {
			const matches = searchRegistry(registry, query);
			const components = matches.map((component) => ({
				name: component.name,
				description: component.description,
				whenToUse: component.whenToUse,
				props: componentPropNames(component.props),
			}));

			const text =
				components.length === 0
					? `No components match "${query ?? ""}".`
					: (() => {
							const width = Math.max(...components.map((component) => component.name.length));
							return components
								.map((component) => `${component.name.padEnd(width)}  ${component.description}`)
								.join("\n");
						})();

			return textResult(text, { components });
		},
	);

	server.registerTool(
		"show_component",
		{
			title: "Show a builtin component",
			description:
				"Show full details (description, when to use it, and its props table with types/required/defaults) for one builtin MDX component, looked up case-insensitively by name. Call this before using a component you haven't used yet, to get its exact prop names and types.",
			inputSchema: showComponentInput,
			outputSchema: showComponentOutput,
		},
		async ({ name }) => {
			const entry = registry.components.find(
				(component) => component.name.toLowerCase() === name.toLowerCase(),
			);
			if (!entry) {
				const suggestions = suggest(registry, name);
				const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
				return errorResult(`Unknown component "${name}".${hint}`);
			}
			return textResult(formatComponent(entry), { component: entry });
		},
	);

	server.registerTool(
		"search_docs",
		{
			title: "Search docs",
			description:
				"Full-text search titles, headings, and bodies of the .md/.mdx docs under the served root. Call this to find where a topic is documented before adding new content, or to check whether something is already covered.",
			inputSchema: searchDocsInput,
			outputSchema: searchDocsOutput,
		},
		async ({ query }) => {
			const roots = getRoots();
			if (roots.length === 0) return errorResult(NO_SERVER_MESSAGE);

			if (remote) {
				const outcome = await remote.searchDocs(query);
				if (outcome.kind === "error") return errorResult(outcome.message);
				if (outcome.kind === "ok") {
					return textResult(formatSearchResults(query, outcome.value), { results: outcome.value });
				}
				// unavailable: fall through to the local index below.
			}

			const { results } = searchDocs(roots, query);
			return textResult(formatSearchResults(query, results), { results });
		},
	);

	server.registerTool(
		"list_docs",
		{
			title: "List docs",
			description:
				"List the tree of .md/.mdx docs (and directories that contain them) under every served root, or under one absolute directory path, up to maxDepth levels deep. Paths are absolute, the same form the site uses in its URLs. Call this to see what docs already exist and which roots are served, e.g. before deciding where a new doc belongs.",
			inputSchema: listDocsInput,
			outputSchema: listDocsOutput,
		},
		async ({ path: dirPath, maxDepth }) => {
			const roots = getRoots();
			if (roots.length === 0) return errorResult(NO_SERVER_MESSAGE);
			const rootDirs = roots.map((rootInfo) => rootInfo.dir);

			if (remote) {
				const outcome = await remote.listDocs(dirPath, maxDepth);
				if (outcome.kind === "error") return errorResult(outcome.message);
				if (outcome.kind === "ok") {
					let dirAbs: string | null = null;
					if (dirPath !== undefined) {
						const hit = await resolveDirPath(rootDirs, dirPath);
						dirAbs = hit.ok ? hit.abs : null;
					}
					return textResult(formatDocTree(outcome.value, dirAbs), { roots: outcome.value });
				}
				// unavailable: fall through to the local walk below.
			}

			let selected: RootInfo[];
			let dirAbs: string | null = null;
			if (dirPath === undefined) {
				selected = roots;
			} else {
				const hit = await resolveDirPath(rootDirs, dirPath);
				if (!hit.ok) return errorResult(hit.error);
				selected = roots.filter((rootInfo) => rootInfo.dir === hit.root);
				dirAbs = hit.abs;
			}

			const out = selected.map((rootInfo) => ({
				name: rootInfo.name,
				dir: rootInfo.dir,
				nodes: readTree(dirAbs ?? rootInfo.dir, maxDepth),
			}));
			return textResult(formatDocTree(out, dirAbs), { roots: out });
		},
	);

	return server;
}
