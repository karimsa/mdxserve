// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockNode } from "@mdxserve/client/document/tree-types";
import {
	DocumentEnvironmentProvider,
	type DocumentEnvironment,
} from "@mdxserve/ui/document/environment";
import { NodeList as SharedNodeList } from "@mdxserve/ui/document/nodes";
import { NodeList } from "../src/document/nodes";

// Links in the shared renderers on the web: plain `<a href>` for the browser in the web
// client, and both kinds of link through `openLink` when an environment handles links.

const PARAGRAPH: BlockNode = {
	type: "paragraph",
	children: [
		{
			type: "link",
			href: "/guide.md",
			title: null,
			children: [{ type: "text", value: "markdown" }],
		},
		{ type: "text", value: " " },
		{
			type: "element",
			id: null,
			tag: "a",
			attrs: { href: "/guide.md" },
			children: [{ type: "text", value: "raw" }],
		},
	],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});

function click(anchor: HTMLAnchorElement): boolean {
	const event = new MouseEvent("click", { bubbles: true, cancelable: true });
	act(() => anchor.dispatchEvent(event));
	return event.defaultPrevented;
}

describe("links in the shared document renderers", () => {
	it("leaves both kinds to the browser in the web client", () => {
		act(() => root.render(<NodeList nodes={[PARAGRAPH]} />));
		const anchors = [...host.querySelectorAll("p > a")] as HTMLAnchorElement[];
		expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual([
			"/guide.md",
			"/guide.md",
		]);
		expect(anchors.map(click)).toEqual([false, false]);
	});

	it("hands both kinds to an environment's openLink", () => {
		const openLink = vi.fn();
		const environment = {
			components: {},
			renderTabs: () => null,
			renderCode: () => null,
			assetUrl: (src: string) => src,
			openLink,
			ErrorBoundary: ({ children }: { children: unknown }) => children,
		} as unknown as DocumentEnvironment;
		act(() =>
			root.render(
				<DocumentEnvironmentProvider value={environment}>
					<SharedNodeList nodes={[PARAGRAPH]} />
				</DocumentEnvironmentProvider>,
			),
		);
		const anchors = [...host.querySelectorAll("p > a")] as HTMLAnchorElement[];
		expect(anchors.map(click)).toEqual([true, true]);
		expect(openLink.mock.calls).toEqual([["/guide.md"], ["/guide.md"]]);
	});
});
