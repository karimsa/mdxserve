import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import type { BlockNode, InlineNode } from "@mdxserve/client/document/tree-types";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { appDocumentEnvironment } from "../src/document-environment";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

// Block builtins and elements whose children come from the document, drawn by the shared
// renderers in the app: a one-line body (`<Callout>Careful.</Callout>`, kept inline by the
// server) and a body that mixes a bare run of text with blocks. React Native throws on text
// outside a `Text`, so each case would crash on a device if a run were left bare.

const sheet = loadCompiledStylesheet();
const text = (value: string): InlineNode => ({ type: "text", value });
const paragraph = (value: string): BlockNode => ({ type: "paragraph", children: [text(value)] });
const kbd: InlineNode = { type: "element", id: null, tag: "kbd", attrs: {}, children: [text("K")] };

/** A one-line body, and a body with a run (text, a key cap, text) between two paragraphs. */
const BODIES: Record<string, (BlockNode | InlineNode)[]> = {
	"one line": [text("Careful.")],
	mixed: [paragraph("Before."), text("Press "), kbd, text(" to search."), paragraph("After.")],
};

function component(
	name: string,
	props: Record<string, string | boolean>,
	children: (BlockNode | InlineNode)[],
): BlockNode {
	return { type: "component", id: null, name, props, children };
}

/** Every container that takes the document's children, around `children`. */
function containers(children: (BlockNode | InlineNode)[]): Record<string, BlockNode> {
	return {
		Callout: component("Callout", { tone: "warn" }, children),
		Card: component("Card", { title: "Title", interactive: false }, children),
		"Card with href": component(
			"Card",
			{ title: "Title", href: "https://example.com", interactive: false },
			children,
		),
		CardGrid: component("CardGrid", { columns: "2" }, [
			component("Card", { title: "Inner", interactive: false }, children),
		]),
		Tab: {
			type: "tabs",
			id: "tabs",
			defaultValue: "a",
			tabs: [{ id: "tabs>a", value: "a", label: "A", children: children as BlockNode[] }],
		},
		details: {
			type: "element",
			id: "details-1",
			tag: "details",
			attrs: {},
			children: [
				{ type: "element", id: null, tag: "summary", attrs: {}, children: [text("More")] },
				...children,
			],
		},
	};
}

function everyStyle(tree: unknown): Record<string, unknown>[] {
	if (!tree || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap(everyStyle);
	const node = tree as { props?: { style?: unknown }; children?: unknown };
	const own = node.props?.style ? [StyleSheet.flatten(node.props.style as never) ?? {}] : [];
	return [...own, ...everyStyle(node.children)];
}

describe.each(["light", "dark"] as const)(
	"document children of a block container (%s)",
	(theme) => {
		const { variables } = resolveTheme(sheet, theme);

		for (const [body, children] of Object.entries(BODIES))
			for (const [name, node] of Object.entries(containers(children)))
				it(`${name}, ${body}`, async () => {
					Uniwind.setTheme(theme);
					const { toJSON } = await render(
						<DocumentEnvironmentProvider value={appDocumentEnvironment}>
							<NodeList nodes={[node]} />
						</DocumentEnvironmentProvider>,
					);
					const words = body === "one line" ? "Careful." : "Press K to search.";
					const run = screen.getByText(words);
					// A line of prose in the body colour, not text left bare in a View.
					expect(StyleSheet.flatten(run.props.style).color).toBe(variables["--text-body"]);
					const styles = everyStyle(toJSON()).flatMap((style) => Object.values(style));
					expect(
						styles.filter(
							(value) => value === undefined || (typeof value === "string" && /var\(/.test(value)),
						),
					).toEqual([]);
				});
	},
);
