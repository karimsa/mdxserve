import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readTree } from "./listing.js";
import { search as searchDocs } from "./search.js";
import { searchRegistry, formatComponent, suggest, type Registry } from "./registry.js";
import { importResolves, resolveDirPath, resolveDocPath } from "./paths.js";
import type { RootInfo } from "./shell.js";
import { validateSource, type ValidationResult, type Diagnostic } from "./validate.js";

export interface McpContext {
	/** Every currently-mounted root, in mount order. Called fresh per tool call. */
	getRoots: () => RootInfo[];
	registry: Registry;
}

const NO_SERVER_MESSAGE = "No mdxserve server is running; start one with `mdxserve serve <dir>`";

const SERVER_VERSION = "0.1.0";

function formatDiagnostic(reportedPath: string, d: Diagnostic): string {
	const line = d.line ?? 0;
	const column = d.column ?? 0;
	const base = `${reportedPath}:${line}:${column}  ${d.severity}  ${d.code}  ${d.message}`;
	if (d.suggestions && d.suggestions.length > 0) {
		return `${base}\n    did you mean: ${d.suggestions.join(", ")}`;
	}
	return base;
}

function formatValidationResult(result: ValidationResult): string {
	const lines = result.diagnostics.map((d) => formatDiagnostic(result.path, d));
	if (result.diagnostics.length === 0) return `OK: ${result.path}`;
	// `ok` only means "no errors" — warnings still need to reach an agent that
	// reads the text rather than the structured output.
	if (result.ok) {
		const n = result.diagnostics.length;
		return [`OK with ${n} warning${n === 1 ? "" : "s"}: ${result.path}`, ...lines].join("\n");
	}
	return lines.join("\n");
}

const validateDocInput = { path: z.string().min(1) };

const diagnosticSchema = z.object({
	severity: z.enum(["error", "warning"]),
	code: z.enum(["mdx-compile", "unknown-component", "unknown-prop", "unresolved-import"]),
	message: z.string(),
	line: z.number().optional(),
	column: z.number().optional(),
	endLine: z.number().optional(),
	endColumn: z.number().optional(),
	component: z.string().optional(),
	prop: z.string().optional(),
	suggestions: z.array(z.string()).optional(),
});

const validateDocOutput = {
	ok: z.boolean(),
	path: z.string(),
	diagnostics: z.array(diagnosticSchema),
};

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

function indentTree(nodes: ReturnType<typeof readTree>, depth = 0): string[] {
	const lines: string[] = [];
	for (const node of nodes) {
		lines.push(`${"  ".repeat(depth)}${node.isDir ? `${node.name}/` : node.name}`);
		if (node.children) lines.push(...indentTree(node.children, depth + 1));
	}
	return lines;
}

export function createMcpServer(ctx: McpContext): McpServer {
	const { getRoots, registry } = ctx;

	const server = new McpServer({ name: "mdxserve", version: SERVER_VERSION });

	server.registerTool(
		"validate_doc",
		{
			title: "Validate a doc",
			description:
				"Validate a Markdown/MDX file under the served root for MDX compile errors, unknown components, and unknown props against the builtin component registry. Call this after writing or editing a .md/.mdx file to catch mistakes (e.g. misspelled component or prop names) before a human sees them rendered. Pass the absolute path (the same form the site uses in its URLs), or a path relative to a served root when only one root contains it.",
			inputSchema: validateDocInput,
			outputSchema: validateDocOutput,
		},
		async ({ path: docPath }) => {
			const roots = getRoots();
			const rootDirs = roots.map((r) => r.dir);
			if (roots.length === 0 && !path.isAbsolute(docPath)) {
				return errorResult(`${NO_SERVER_MESSAGE}, or pass an absolute path`);
			}

			const resolved = await resolveDocPath(rootDirs, docPath);
			if (!resolved.ok) return errorResult(resolved.error);

			let source: string;
			try {
				source = await fs.promises.readFile(resolved.abs, "utf8");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return errorResult(`Failed to read ${resolved.abs}: ${message}`);
			}

			const result = await validateSource({
				source,
				path: resolved.abs,
				registry,
				resolveImport: (specifier) => importResolves(resolved.abs, specifier),
			});

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
			const components = matches.map((c) => ({
				name: c.name,
				description: c.description,
				whenToUse: c.whenToUse,
				props: componentPropNames(c.props),
			}));

			const text =
				components.length === 0
					? `No components match "${query ?? ""}".`
					: (() => {
							const width = Math.max(...components.map((c) => c.name.length));
							return components.map((c) => `${c.name.padEnd(width)}  ${c.description}`).join("\n");
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
			const entry = registry.components.find((c) => c.name.toLowerCase() === name.toLowerCase());
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

			const { results } = searchDocs(roots, query);
			const text =
				results.length === 0
					? `No docs match "${query}".`
					: results.map((r) => `${r.path} — ${r.title}\n    ${r.excerpt}`).join("\n");
			return textResult(text, { results });
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
			const rootDirs = roots.map((r) => r.dir);

			let selected: RootInfo[];
			let dirAbs: string | null = null;
			if (dirPath === undefined) {
				selected = roots;
			} else {
				const hit = await resolveDirPath(rootDirs, dirPath);
				if (!hit.ok) return errorResult(hit.error);
				selected = roots.filter((r) => r.dir === hit.root);
				dirAbs = hit.abs;
			}

			const out = selected.map((r) => ({
				name: r.name,
				dir: r.dir,
				nodes: readTree(dirAbs ?? r.dir, maxDepth),
			}));
			const text = out
				.map((r) => {
					const body = r.nodes.length === 0 ? "  (no docs)" : indentTree(r.nodes, 1).join("\n");
					return `${r.name} (${dirAbs ?? r.dir})\n${body}`;
				})
				.join("\n\n");
			return textResult(text, { roots: out });
		},
	);

	return server;
}
