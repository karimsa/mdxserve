import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet, View } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import { indexDocument } from "@mdxserve/client/document/document-index";
import type { DocumentTree } from "@mdxserve/client/document/tree-types";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { appDocumentEnvironment } from "../src/document-environment";
import { documentRows, rowType } from "../src/document/rows";
import { tocLines } from "../src/document/contents";
import { loadCompiledStylesheet, resolveTheme, unusable } from "./stylesheet/analyze.js";
import { classesInAppSource, classesInSource } from "./stylesheet/source-classes.js";
import markdownTour from "./fixtures/01-markdown.md.json";
import builtins from "./fixtures/06-builtins.mdx.json";
import readme from "./fixtures/README.md.json";

// The fixtures are `getDocument` results for documents in example/, fetched from a built server
// over that folder, with the folder's path replaced by /srv/example.
const FIXTURES = {
	"01-markdown.md": markdownTour,
	"06-builtins.mdx": builtins,
	"README.md": readme,
} as unknown as Record<string, { document: DocumentTree; version: string }>;

const sheet = loadCompiledStylesheet();

function everyStyle(tree: unknown): Record<string, unknown>[] {
	if (!tree || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap(everyStyle);
	const node = tree as { props?: { style?: unknown }; children?: unknown };
	const own = node.props?.style ? [StyleSheet.flatten(node.props.style as never) ?? {}] : [];
	return [...own, ...everyStyle(node.children)];
}

function unresolved(tree: unknown): string[] {
	return everyStyle(tree).flatMap((style) =>
		Object.entries(style).flatMap(([property, value]) =>
			value === undefined || (typeof value === "string" && /var\(|calc\(/.test(value))
				? [`${property}: ${String(value)}`]
				: [],
		),
	);
}

describe.each(Object.entries(FIXTURES))("the rows of %s", (_, { document }) => {
	const { rows, rowOf } = documentRows(document);

	it("give every block its own row, a section's heading included, so one long section is many rows", () => {
		expect(rows.length).toBeGreaterThan(document.children.length);
		expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
		for (const row of rows) expect(row.nodes).toHaveLength(1);
	});

	it("place every heading and tab of the table of contents in a row", () => {
		const lines = tocLines(document.toc, indexDocument(document).sectionLevels);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) expect(rowOf.get(line.id)).toBeLessThan(rows.length);
	});

	it("keep each unchanged block's row props across a refetch with structural sharing", () => {
		const again = documentRows(document);
		again.rows.forEach((row, position) => expect(row.nodes).toBe(rows[position].nodes));
	});

	it("place every node a link can reveal, tabs and builtins included", () => {
		for (const id of indexDocument(document).tabSteps.keys()) expect(rowOf.has(id)).toBe(true);
	});
});

describe.each(["light", "dark"] as const)("every row of the example documents (%s)", (theme) => {
	it.each(Object.keys(FIXTURES))(
		"draws %s with the theme's tokens and no unresolved style",
		async (name) => {
			Uniwind.setTheme(theme);
			const { document } = FIXTURES[name];
			const { rows } = documentRows(document);
			const { toJSON } = await render(
				<DocumentEnvironmentProvider value={appDocumentEnvironment}>
					<View>
						{rows.map((row) => (
							<NodeList key={row.key} nodes={row.nodes} />
						))}
					</View>
				</DocumentEnvironmentProvider>,
			);
			expect(screen.queryByText(/^Unsupported /)).toBeNull();
			expect(unresolved(toJSON())).toEqual([]);
		},
	);
});

describe("the reading screen's classes", () => {
	it.each(["light", "dark"])(
		"are all in the compiled stylesheet with usable values (%s)",
		(theme) => {
			const { classes } = resolveTheme(sheet, theme);
			const used = [
				...classesInAppSource("src/document/DocumentScreen.tsx"),
				...classesInAppSource("src/document/ContentsScreen.tsx"),
				...classesInAppSource("src/document/DocumentImage.tsx"),
				// `"th"` is a tag name a class template compares with, not a class.
				...classesInSource("document/elements.tsx").filter((name) => name !== "th"),
			];
			const problems = used.flatMap((className) => {
				const style = classes[className];
				if (!style) return [`${className}: not in the stylesheet`];
				return Object.entries(style).flatMap(([property, value]) => {
					const why = unusable(value);
					return why ? [`${className} ${property}: ${why}`] : [];
				});
			});
			expect(problems).toEqual([]);
		},
	);
});

describe("rowType", () => {
	const code = (lang: string) => ({
		type: "code" as const,
		id: null,
		lang,
		title: null,
		showLineNumbers: false,
		highlightLines: [],
		value: "",
	});

	it("names a Mermaid block's row a diagram, so it is reused only for another diagram", () => {
		expect(rowType({ key: "#a", nodes: [code("mermaid")] })).toBe("diagram");
	});

	it.each(Object.entries(FIXTURES))(
		"leaves every other row of %s its node type",
		(_, { document }) => {
			for (const row of documentRows(document).rows) {
				const first = row.nodes[0]!;
				const mermaid = first.type === "code" && first.lang === "mermaid";
				expect(rowType(row)).toBe(mermaid ? "diagram" : first.type);
			}
			expect(rowType({ key: "#b", nodes: [code("ts")] })).toBe("code");
		},
	);
});
