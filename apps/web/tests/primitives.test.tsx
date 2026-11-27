// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { List, ListItem } from "@mdxserve/ui/primitives/List";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Code, Heading, Link, Text } from "@mdxserve/ui/primitives/Text";

// The primitives as the browser gets them: the HTML element each role stands for.

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

function draw(element: ReactElement) {
	act(() => root.render(element));
}

describe("text primitives", () => {
	it("renders a paragraph with its inline runs, code and link", () => {
		draw(
			<Text paragraph={true} tone="muted">
				Run <Code>mdxserve serve</Code>, then read <Link href="/docs/guide.md">the guide</Link>.
			</Text>,
		);
		const paragraph = host.querySelector("p")!;
		expect(paragraph.textContent).toBe("Run mdxserve serve, then read the guide.");
		expect(paragraph.className).toContain("text-text-muted");
		expect(paragraph.querySelector("code")!.textContent).toBe("mdxserve serve");
		expect(paragraph.querySelector("a")!.getAttribute("href")).toBe("/docs/guide.md");
		expect(host.querySelector("div")).toBeNull();
	});

	it("renders each heading level as its element, with its anchor", () => {
		draw(
			<>
				<Heading level={2} nativeID="install">
					Install
				</Heading>
				<Heading level={4}>Notes</Heading>
			</>,
		);
		expect(host.querySelector("h2")!.id).toBe("install");
		expect(host.querySelector("h2")!.className).toContain("font-bold");
		expect(host.querySelector("h4")!.textContent).toBe("Notes");
	});

	it("renders a list as ul and li", () => {
		draw(
			<List>
				<ListItem>
					<Text>One</Text>
				</ListItem>
				<ListItem>
					<Text>Two</Text>
				</ListItem>
			</List>,
		);
		expect([...host.querySelectorAll("ul > li")].map((item) => item.textContent)).toEqual([
			"One",
			"Two",
		]);
	});
});

describe("Pressable", () => {
	it("is a button that reports a click", () => {
		const onPress = vi.fn();
		draw(
			<Pressable onPress={onPress} aria-label="Copy">
				<Text>Copy</Text>
			</Pressable>,
		);
		const button = host.querySelector("button")!;
		expect(button.getAttribute("aria-label")).toBe("Copy");
		act(() => button.click());
		expect(onPress).toHaveBeenCalledTimes(1);
	});
});

describe("Icon", () => {
	it("draws a lucide glyph by name and nothing for an unknown name", () => {
		draw(
			<>
				<Icon name="info" size="lg" className="text-status-info-fg" />
				<Icon name="no-such-icon" />
			</>,
		);
		const svgs = host.querySelectorAll("svg");
		expect(svgs).toHaveLength(1);
		expect(svgs[0].getAttribute("data-icon")).toBe("info");
		expect(svgs[0].getAttribute("width")).toBe("20");
		expect(svgs[0].getAttribute("class")).toContain("text-status-info-fg");
	});
});
