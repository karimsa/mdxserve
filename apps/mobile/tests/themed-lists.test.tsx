import { describe, expect, it } from "@jest/globals";
import { render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import type { BlockNode } from "@mdxserve/client/document/tree-types";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { appDocumentEnvironment } from "../src/document-environment";

// A list item's blocks stack: a nested list sits under its parent's text, not beside it, and
// a task item's checkbox takes the marker's place beside the text.

const paragraph = (value: string): BlockNode => ({
	type: "paragraph",
	children: [{ type: "text", value }],
});

const NESTED: BlockNode = {
	type: "list",
	ordered: false,
	start: null,
	items: [
		{
			checked: null,
			children: [
				paragraph("Parent"),
				{
					type: "list",
					ordered: false,
					start: null,
					items: [{ checked: null, children: [paragraph("Child")] }],
				},
			],
		},
		{ checked: true, children: [paragraph("Done"), paragraph("A second paragraph.")] },
	],
};

interface HostView {
	props: { style?: unknown; role?: string };
	parent: HostView | null;
	children: unknown[];
}

/** The list item a text sits in. */
function itemOf(word: string): HostView {
	let node = screen.getByText(word) as unknown as HostView | null;
	while (node && node.props.role !== "listitem") node = node.parent;
	if (!node) throw new Error(`${word} is in no list item`);
	return node;
}

/** The flex direction of a host view, as its compiled classes resolve (column by default). */
function direction(view: { props: { style?: unknown } }): unknown {
	return (StyleSheet.flatten(view.props.style as never) ?? {}).flexDirection ?? "column";
}

describe.each(["light", "dark"] as const)("list items in the %s theme", (theme) => {
	it("stack an item's paragraphs and nested list one under another", async () => {
		Uniwind.setTheme(theme);
		await render(
			<DocumentEnvironmentProvider value={appDocumentEnvironment}>
				<NodeList nodes={[NESTED]} />
			</DocumentEnvironmentProvider>,
		);
		const parent = itemOf("Parent");
		const done = itemOf("Done");
		// The row is marker | content; the content column holds the blocks, top to bottom.
		expect(direction(parent)).toBe("row");
		const content = parent.children[1] as HostView;
		expect(direction(content)).toBe("column");
		expect(within(parent as never).getByText("Child")).toBeOnTheScreen();

		const doneContent = done.children[1] as HostView;
		expect(within(doneContent as never).getByText("A second paragraph.")).toBeOnTheScreen();
		expect(direction(doneContent)).toBe("column");
		expect(within(done as never).getByRole("checkbox", { checked: true })).toBeOnTheScreen();
		expect(within(done as never).queryByText("•")).toBeNull();
	});
});
