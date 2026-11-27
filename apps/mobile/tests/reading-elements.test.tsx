import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import * as fc from "fast-check";
import { Uniwind } from "uniwind";
import "../src/global.css";
import type { TreeNode } from "@mdxserve/client/document/tree-types";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { appDocumentEnvironment } from "../src/document-environment";

// React Native draws text only inside a `Text`: a string that reaches a `View` throws on a device
// ("Text strings must be rendered within a <Text> component"), and the test renderer throws the
// same. These trees put HTML elements, with and without their attributes, around inline text.

const text = (value: string) => ({ type: "text", value });
const element = (tag: string, attrs: Record<string, string | boolean>, children: unknown[]) => ({
	type: "element",
	id: tag === "details" ? `details-${tag}` : null,
	tag,
	attrs,
	children,
});
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });

async function draw(nodes: unknown[]) {
	return render(
		<DocumentEnvironmentProvider value={appDocumentEnvironment}>
			<NodeList nodes={nodes as TreeNode[]} />
		</DocumentEnvironmentProvider>,
	);
}

const TAGS = [
	"a",
	"abbr",
	"b",
	"br",
	"details",
	"em",
	"i",
	"img",
	"kbd",
	"mark",
	"s",
	"small",
	"span",
	"strong",
	"sub",
	"summary",
	"sup",
	"table",
	"tbody",
	"td",
	"th",
	"thead",
	"tr",
	"u",
	// Tags no document may write: a placeholder stands in.
	"q",
	"cite",
	"time",
	"label",
	"custom-thing",
];

const attrs = fc.oneof(
	fc.constant({}),
	fc.constant({ href: "" }),
	fc.constant({ href: true }),
	fc.constant({ href: "https://example.com" }),
	fc.constant({ src: "", alt: "" }),
	fc.constant({ title: "x", colspan: "2" }),
);

const { tree } = fc.letrec((tie) => ({
	tree: fc.oneof(
		{ depthSize: "small", withCrossShrink: true },
		fc.string({ maxLength: 6 }).map(text),
		fc
			.record({
				tag: fc.constantFrom(...TAGS),
				attrs,
				children: fc.array(tie("tree"), { maxLength: 3 }),
			})
			.map(({ tag, attrs: given, children }) => element(tag, given, children)),
		fc.array(tie("tree"), { maxLength: 3 }).map((children) => paragraph(...children)),
	),
}));

/** What a document's top level holds: elements and paragraphs, never bare text. */
const block = tree.filter((node) => (node as { type: string }).type !== "text");

describe.each(["light", "dark"] as const)("HTML elements in the app (%s)", (theme) => {
	it.each([
		["an anchor with an empty destination", [element("a", { href: "" }, [text("Label")])]],
		["an anchor with no destination", [element("a", {}, [text("Label")])]],
		["an anchor with a bare `href`", [element("a", { href: true }, [text("Label")])]],
		["an anchor in a paragraph", [paragraph(text("See "), element("a", {}, [text("Label")]))]],
		["an inline element around a bare word", [element("span", {}, [text("Label")])]],
		["a table body with a bare word", [element("tbody", {}, [text("Label")])]],
	])("draws %s as text", async (_, nodes) => {
		Uniwind.setTheme(theme);
		await draw(nodes);
		expect(screen.getByText(/Label/)).toBeOnTheScreen();
	});

	it("never puts a string straight into a view, whatever elements wrap it (property)", async () => {
		Uniwind.setTheme(theme);
		await fc.assert(
			fc.asyncProperty(fc.array(block, { minLength: 1, maxLength: 3 }), async (nodes) => {
				const { unmount } = await draw(nodes);
				await unmount();
			}),
			{ numRuns: 60 },
		);
	});
});
