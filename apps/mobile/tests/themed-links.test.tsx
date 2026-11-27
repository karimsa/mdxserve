import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import type { BlockNode, InlineNode } from "@mdxserve/client/document/tree-types";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { appDocumentEnvironment } from "../src/document-environment";

// A raw HTML `<a href>` in a document goes where a Markdown link goes: through the
// environment's `openLink`, for a web address, another document or a heading alike.

const text = (value: string): InlineNode => ({ type: "text", value });

function paragraphOf(href: string): BlockNode {
	return {
		type: "paragraph",
		children: [
			{ type: "link", href, title: null, children: [text("markdown link")] },
			text(" and "),
			{ type: "element", id: null, tag: "a", attrs: { href }, children: [text("raw anchor")] },
		],
	};
}

describe.each(["light", "dark"] as const)("links in a document (%s)", (theme) => {
	it.each(["https://example.com/page", "/notes/guide.md", "#install"])(
		"hands %s to openLink from a Markdown link and from a raw <a>",
		async (href) => {
			Uniwind.setTheme(theme);
			const openLink = jest.fn<(href: string) => void>();
			await render(
				<DocumentEnvironmentProvider value={{ ...appDocumentEnvironment, openLink }}>
					<NodeList nodes={[paragraphOf(href)]} />
				</DocumentEnvironmentProvider>,
			);
			await fireEvent.press(screen.getByText("markdown link"));
			await fireEvent.press(screen.getByText("raw anchor"));
			expect(openLink.mock.calls).toEqual([[href], [href]]);
		},
	);

	it("opens a raw anchor's web address in the browser with the app's own handler", async () => {
		Uniwind.setTheme(theme);
		const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
		await render(
			<DocumentEnvironmentProvider value={appDocumentEnvironment}>
				<NodeList nodes={[paragraphOf("https://example.com/page")]} />
			</DocumentEnvironmentProvider>,
		);
		await fireEvent.press(screen.getByText("raw anchor"));
		expect(openURL).toHaveBeenCalledWith("https://example.com/page");
		openURL.mockRestore();
	});
});
