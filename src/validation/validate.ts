import { compile } from "@mdx-js/mdx";
import { VFileMessage } from "vfile-message";
import type { Root, RootContent } from "mdast";
// Importing these types (re-exported from mdast-util-mdx-jsx/mdast-util-mdxjs-esm)
// also pulls in their `declare module "mdast"` augmentations — mdxJsxFlowElement,
// mdxJsxTextElement, mdxjsEsm, ... — so the `RootContent` union above includes them.
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx";
import type { Pattern, Program } from "estree";
import { mdxCompileOptions } from "../rendering/mdx/mdx-options.js";
import { escapeBareLt } from "../rendering/mdx/lenient-md.js";
import { suggest, suggestFrom, type Registry } from "../components/registry.js";
import type { RenderOutcome } from "../rendering/protocol.js";

export type DiagnosticCode =
	"mdx-compile" | "unknown-component" | "unknown-prop" | "unresolved-import" | "render-error";

export interface Diagnostic {
	severity: "error" | "warning";
	code: DiagnosticCode;
	message: string;
	line?: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
	component?: string;
	prop?: string;
	suggestions?: string[];
}

export interface ValidationResult {
	ok: boolean;
	path: string;
	diagnostics: Diagnostic[];
	/** Whether the render step actually ran (a `render` was given and no static error existed). */
	rendered: boolean;
}

/**
 * Names bound by top-level MDX ESM statements: `import` specifiers and named
 * `export const`/`export function` declarations. Used to tell a
 * locally-defined/imported component apart from an unknown one.
 */
export function collectLocalNames(tree: Root): Set<string> {
	const names = new Set<string>();

	function visit(node: RootContent | Root) {
		if (node.type === "mdxjsEsm") {
			const estree = node.data?.estree as Program | undefined;
			if (estree) {
				collectFromProgram(estree, names);
			} else {
				for (const name of collectFromSource(node.value)) names.add(name);
			}
		}
		if ("children" in node && Array.isArray(node.children)) {
			for (const child of node.children as RootContent[]) visit(child);
		}
	}

	visit(tree);
	return names;
}

function collectFromProgram(program: Program, names: Set<string>): void {
	for (const stmt of program.body) {
		if (stmt.type === "ImportDeclaration") {
			for (const spec of stmt.specifiers) names.add(spec.local.name);
		} else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
			const decl = stmt.declaration;
			if (decl.type === "VariableDeclaration") {
				for (const d of decl.declarations) collectPatternNames(d.id, names);
			} else if (
				(decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") &&
				decl.id
			) {
				names.add(decl.id.name);
			}
		} else if (stmt.type === "ExportDefaultDeclaration") {
			// `export default function Foo() {}` sets the MDX layout *and* binds
			// `Foo` in the file's scope, so `<Foo />` renders.
			const decl = stmt.declaration;
			if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id) {
				names.add(decl.id.name);
			}
		}
	}
}

function collectPatternNames(pattern: Pattern, names: Set<string>): void {
	switch (pattern.type) {
		case "Identifier":
			names.add(pattern.name);
			break;
		case "ObjectPattern":
			for (const prop of pattern.properties) {
				if (prop.type === "RestElement") collectPatternNames(prop.argument, names);
				else collectPatternNames(prop.value as Pattern, names);
			}
			break;
		case "ArrayPattern":
			for (const el of pattern.elements) if (el) collectPatternNames(el, names);
			break;
		case "AssignmentPattern":
			collectPatternNames(pattern.left, names);
			break;
		case "RestElement":
			collectPatternNames(pattern.argument, names);
			break;
		default:
			break;
	}
}

/** Regex fallback for when an `mdxjsEsm` node has no `data.estree` attached. */
function collectFromSource(value: string): string[] {
	const names: string[] = [];
	for (const m of value.matchAll(/import\s+([^;]+?)\s+from\s+["'][^"']*["']/g)) {
		names.push(...parseImportClause(m[1]));
	}
	for (const m of value.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
		names.push(m[1]);
	}
	for (const m of value.matchAll(
		/export\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s*\*?\s*([A-Za-z_$][\w$]*)/g,
	)) {
		names.push(m[1]);
	}
	return names;
}

function parseImportClause(clause: string): string[] {
	const names: string[] = [];
	const trimmed = clause.trim();
	const nsMatch = trimmed.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/);
	if (nsMatch) {
		names.push(nsMatch[1]);
		return names;
	}
	const braceMatch = trimmed.match(/\{([^}]*)\}/);
	let rest = trimmed;
	if (braceMatch) {
		for (const part of braceMatch[1].split(",")) {
			const p = part.trim();
			if (!p) continue;
			const asMatch = p.match(/as\s+([A-Za-z_$][\w$]*)\s*$/);
			names.push(asMatch ? asMatch[1] : p.split(/\s+/)[0]);
		}
		rest = trimmed.slice(0, braceMatch.index).replace(/,\s*$/, "").trim();
	}
	if (rest) {
		const defaultMatch = rest.match(/^([A-Za-z_$][\w$]*)/);
		if (defaultMatch) names.push(defaultMatch[1]);
	}
	return names;
}

function didYouMean(suggestions: string[]): string {
	return suggestions.length > 0 ? ` Did you mean ${suggestions[0]}?` : "";
}

/**
 * Walk the mdast tree for unregistered JSX components and, on registered
 * components, unrecognized attributes. Pure and synchronous.
 */
export function analyzeTree(tree: Root, registry: Registry): Diagnostic[] {
	const localNames = collectLocalNames(tree);
	const byName = new Map(registry.components.map((c) => [c.name, c] as const));
	const diagnostics: Diagnostic[] = [];
	const seenUnknown = new Set<string>();

	function checkElement(node: MdxJsxFlowElement | MdxJsxTextElement) {
		const name = node.name;
		if (name === null) return; // fragment (<>...</>)
		const first = name[0];
		if (first && first === first.toLowerCase() && first !== first.toUpperCase()) return; // html tag

		const head = name.split(".")[0];
		if (localNames.has(head)) return; // locally imported/declared — never checked

		// Builtins have no members: `<Callout.Foo>` resolves the full dotted
		// name at render time and blanks the page just like an unknown tag.
		const entry = name === head ? byName.get(head) : undefined;
		if (!entry) {
			const line = node.position?.start.line;
			const column = node.position?.start.column;
			const key = `${name}:${line}:${column}`;
			if (!seenUnknown.has(key)) {
				seenUnknown.add(key);
				const suggestions = suggest(registry, head);
				diagnostics.push({
					severity: "error",
					code: "unknown-component",
					message: `Unknown component <${name}>.${didYouMean(suggestions)}`,
					line,
					column,
					endLine: node.position?.end.line,
					endColumn: node.position?.end.column,
					component: name,
					suggestions,
				});
			}
			return;
		}

		const propNames = Object.keys(
			(entry.props?.properties as Record<string, unknown> | undefined) ?? {},
		);
		const allowed = new Set([...propNames, "children", "key"]);

		for (const attr of node.attributes) {
			if (attr.type !== "mdxJsxAttribute") continue; // skip {...spread} attributes
			if (allowed.has(attr.name)) continue;
			const jsxAttr = attr as MdxJsxAttribute;
			const suggestions = suggestFrom(propNames, jsxAttr.name);
			diagnostics.push({
				severity: "warning",
				code: "unknown-prop",
				message: `Unknown prop "${jsxAttr.name}" on <${head}>.${didYouMean(suggestions)}`,
				line: jsxAttr.position?.start.line ?? node.position?.start.line,
				column: jsxAttr.position?.start.column ?? node.position?.start.column,
				endLine: jsxAttr.position?.end.line ?? node.position?.end.line,
				endColumn: jsxAttr.position?.end.column ?? node.position?.end.column,
				component: head,
				prop: jsxAttr.name,
				suggestions,
			});
		}
	}

	function visit(node: RootContent | Root) {
		if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
			checkElement(node);
		}
		if ("children" in node && Array.isArray(node.children)) {
			for (const child of node.children as RootContent[]) visit(child);
		}
	}

	visit(tree);
	return diagnostics;
}

interface RelativeImport {
	specifier: string;
	line?: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
}

function collectRelativeImports(tree: Root): RelativeImport[] {
	const imports: RelativeImport[] = [];

	function visit(node: RootContent | Root) {
		if (node.type === "mdxjsEsm") {
			// The ESM node's position is the whole import block; acorn's `loc`
			// (when present) narrows it to the one statement.
			const block = {
				line: node.position?.start.line,
				column: node.position?.start.column,
				endLine: node.position?.end.line,
				endColumn: node.position?.end.column,
			};
			const estree = node.data?.estree as Program | undefined;
			if (estree) {
				for (const stmt of estree.body) {
					if (stmt.type === "ImportDeclaration" && typeof stmt.source.value === "string") {
						const specifier = stmt.source.value;
						if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
						const loc = stmt.loc;
						imports.push(
							loc
								? {
										specifier,
										line: loc.start.line,
										column: loc.start.column + 1,
										endLine: loc.end.line,
										endColumn: loc.end.column + 1,
									}
								: { specifier, ...block },
						);
					}
				}
			} else {
				for (const m of node.value.matchAll(/from\s+["'](\.\.?\/[^"']*)["']/g)) {
					imports.push({ specifier: m[1], ...block });
				}
			}
		}
		if ("children" in node && Array.isArray(node.children)) {
			for (const child of node.children as RootContent[]) visit(child);
		}
	}

	visit(tree);
	return imports;
}

/** Turn a thrown `compile()` error into a single diagnostic. */
export function fromCompileError(error: unknown): Diagnostic {
	if (error instanceof VFileMessage) {
		let line = error.line;
		let column = error.column;
		let endLine: number | undefined;
		let endColumn: number | undefined;
		const place = error.place;
		if (place && "start" in place) {
			line = line ?? place.start.line;
			column = column ?? place.start.column;
			endLine = place.end?.line;
			endColumn = place.end?.column;
		} else if (place) {
			line = line ?? place.line;
			column = column ?? place.column;
		}
		// Some messages (e.g. mdast-util-mdx-jsx's "end-tag-mismatch" when a tag
		// is left open at EOF, with no matching closer at all) carry no `place`
		// whatsoever — the position is only embedded in the reason text, e.g.
		// "Expected a closing tag for `<Callout>` (1:1-1:10)".
		if (line === undefined) {
			const match = error.reason.match(/\((\d+):(\d+)(?:-(\d+):(\d+))?\)/);
			if (match) {
				line = Number(match[1]);
				column = Number(match[2]);
				if (match[3] !== undefined) {
					endLine = Number(match[3]);
					endColumn = Number(match[4]);
				}
			}
		}
		return {
			severity: "error",
			code: "mdx-compile",
			message: error.reason,
			line,
			column,
			endLine,
			endColumn,
		};
	}
	const message = error instanceof Error ? error.message : String(error);
	return { severity: "error", code: "mdx-compile", message };
}

export interface ValidateSourceInput {
	source: string;
	path: string;
	registry: Registry;
	resolveImport?: (specifier: string) => boolean;
	/**
	 * Server-side render step, run after static analysis finds no `error`
	 * diagnostic (an unknown component would just throw again with a worse
	 * message). Absent when no mdxserve server is available to render with.
	 */
	render?: (absPath: string) => Promise<RenderOutcome>;
}

/**
 * Compile `source` as MDX and report unregistered components, unrecognized
 * props on registered ones, (when `resolveImport` is given) unresolved
 * relative imports, and (when `render` is given, and only once the doc is
 * otherwise clean) any error thrown while actually rendering it.
 */
export async function validateSource(input: ValidateSourceInput): Promise<ValidationResult> {
	const { path: filePath, registry, resolveImport, render } = input;

	// escapeBareLt never adds/removes lines, so `line` stays exact; `column`
	// may drift by a character or two on a line where a `<` got escaped.
	const value = /\.md$/i.test(filePath) ? escapeBareLt(input.source) : input.source;

	let captured: Root | undefined;
	const captureTree = () => (tree: Root) => {
		captured = tree;
	};

	let diagnostics: Diagnostic[];
	try {
		await compile({ value, path: filePath }, mdxCompileOptions({ remarkPlugins: [captureTree] }));
		diagnostics = captured ? analyzeTree(captured, registry) : [];
	} catch (error) {
		diagnostics = [fromCompileError(error)];
	}

	if (captured && resolveImport) {
		for (const { specifier, ...position } of collectRelativeImports(captured)) {
			if (!resolveImport(specifier)) {
				diagnostics.push({
					severity: "warning",
					code: "unresolved-import",
					message: `Cannot resolve import "${specifier}".`,
					...position,
				});
			}
		}
	}

	let rendered = false;
	if (render && !diagnostics.some((d) => d.severity === "error")) {
		rendered = true;
		const outcome = await render(filePath);
		if (!outcome.ok) {
			diagnostics.push({
				severity: "error",
				code: "render-error",
				message: outcome.message,
				line: outcome.line,
				column: outcome.column,
			});
		}
	}

	const ok = !diagnostics.some((d) => d.severity === "error");
	return { ok, path: filePath, diagnostics, rendered };
}
