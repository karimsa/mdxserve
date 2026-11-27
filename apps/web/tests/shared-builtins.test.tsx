// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Badge from "@mdxserve/ui/builtins/Badge";
import Callout from "@mdxserve/ui/builtins/Callout";
import Card, { CardGrid } from "@mdxserve/ui/builtins/Card";
import FileTree from "@mdxserve/ui/builtins/FileTree";
import Kbd from "@mdxserve/ui/builtins/Kbd";
import Screenshot from "@mdxserve/ui/builtins/Screenshot";
import Tooltip from "@mdxserve/ui/builtins/Tooltip";
import Tabs from "@mdxserve/ui/builtins/Tabs";

// The shared builtins (@mdxserve/ui) as the browser gets them: React Native components
// through react-native-web, with the elements the web client rendered before they moved.

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
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

describe("Badge", () => {
	it("stays phrasing content, so it may sit in a paragraph", () => {
		draw(
			<p>
				Status:{" "}
				<Badge tone="ok" variant="soft" dot={true}>
					Online
				</Badge>
			</p>,
		);
		const badge = host.querySelector("p > span")!;
		expect(badge.textContent).toBe("Online");
		expect(badge.className).toContain("bg-status-ok-bg");
		expect(host.querySelector("p div")).toBeNull();
		expect(badge.querySelector('[aria-hidden="true"]')!.className).toContain("rounded-full");
	});
});

describe("Callout", () => {
	it("titles the box with a paragraph, defaulting to the tone's label", () => {
		draw(
			<Callout tone="warn">
				<p>Body</p>
			</Callout>,
		);
		const title = host.querySelector("p.font-bold")!;
		expect(title.textContent).toBe("Careful");
		expect(title.className).toContain("text-status-warn-fg");
		expect(host.querySelector('svg[data-icon="triangle-alert"]')).not.toBeNull();
		expect(host.textContent).toContain("Body");
	});
});

describe("Tabs", () => {
	const tabs = [
		{ id: "os>mac", value: "mac", label: "macOS", content: <p>Use brew.</p> },
		{
			id: "os>linux",
			value: "linux",
			label: "Linux",
			content: <p>Use apt.</p>,
		},
	];

	it("renders an ARIA tab list over panels that all stay mounted", () => {
		draw(<Tabs id="os" tabs={tabs} selected="mac" onSelect={() => {}} />);
		const [mac, linux] = host.querySelectorAll<HTMLElement>('[role="tablist"] > [role="tab"]');
		expect(mac.getAttribute("aria-selected")).toBe("true");
		expect(mac.getAttribute("aria-controls")).toBe("os>mac");
		expect(mac.tabIndex).toBe(0);
		expect(linux.tabIndex).toBe(-1);

		const panel = host.querySelector<HTMLElement>('[id="os>linux"]')!;
		expect(panel.getAttribute("role")).toBe("tabpanel");
		expect(panel.getAttribute("aria-labelledby")).toBe("os>linux~tab");
		expect(panel.dataset).toMatchObject({ tabPanel: "", tabsId: "os", tabValue: "linux" });
		expect(panel.classList.contains("hidden")).toBe(true);
		expect(panel.textContent).toBe("Use apt.");
		expect(host.querySelector('[data-tabs="os"]')).not.toBeNull();
	});

	it("moves the selection with the arrow keys", () => {
		const onSelect = vi.fn();
		draw(<Tabs id="os" tabs={tabs} selected="mac" onSelect={onSelect} />);
		const list = host.querySelector('[role="tablist"]')!;
		act(() => {
			list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		});
		expect(onSelect).toHaveBeenCalledWith("linux");
	});

	it("selects a tab that is clicked", () => {
		const onSelect = vi.fn();
		draw(<Tabs id="os" tabs={tabs} selected="mac" onSelect={onSelect} />);
		act(() => host.querySelectorAll<HTMLElement>('[role="tab"]')[1].click());
		expect(onSelect).toHaveBeenCalledWith("linux");
	});
});

describe("Kbd", () => {
	it("is a <kbd> in the line of text", () => {
		draw(
			<p>
				Press <Kbd>⌘</Kbd>
				<Kbd>K</Kbd>
			</p>,
		);
		const keys = host.querySelectorAll("p > kbd");
		expect([...keys].map((key) => key.textContent)).toEqual(["⌘", "K"]);
		expect(keys[0].className).toContain("border-b-2");
		expect(host.querySelector("p div")).toBeNull();
	});
});

describe("Card", () => {
	it("is a link with href, a plain box without, inside a grid", () => {
		draw(
			<CardGrid columns="3">
				<Card
					title="Start"
					description="Point it at a folder."
					href="/01-markdown.md"
					meta="2 min"
					interactive={false}
				/>
				<Card title="Diagrams" interactive={true} />
			</CardGrid>,
		);
		const grid = host.firstElementChild!;
		expect(grid.className).toContain("web:lg:grid-cols-3");
		const link = host.querySelector<HTMLAnchorElement>("a[href='/01-markdown.md']")!;
		expect(link.textContent).toBe("StartPoint it at a folder.2 min");
		expect(link.textContent).not.toContain("Diagrams");
		expect(link.querySelector("p")!.textContent).toBe("Point it at a folder.");
		expect(link.querySelector('svg[data-icon="arrow-right"]')).not.toBeNull();
		expect(host.querySelectorAll("a")).toHaveLength(1);
		expect(host.querySelectorAll("button")).toHaveLength(0);
	});

	it("keeps the document's inline content on one line", () => {
		draw(
			<Card title="Start" interactive={false}>
				<span>First</span> <span>Second</span>
			</Card>,
		);
		const first = [...host.querySelectorAll("span")].find((span) => span.textContent === "First")!;
		const block = first.parentElement!;
		expect(block.textContent).toBe("First Second");
		expect(block.className).toContain("web:block");
	});
});

describe("FileTree", () => {
	it("opens and closes a folder from its button", () => {
		draw(
			<FileTree
				id="tree"
				activePath="deploy"
				nodes={[
					{ name: "docs", children: [{ name: "deploy.mdx", path: "deploy" }] },
					{ name: "package.json" },
				]}
			/>,
		);
		const folder = host.querySelector<HTMLButtonElement>("button")!;
		expect(folder.textContent).toBe("docs");
		expect(folder.getAttribute("aria-expanded")).toBe("true");
		expect(host.textContent).toContain("deploy.mdx");
		act(() => folder.click());
		expect(folder.getAttribute("aria-expanded")).toBe("false");
		expect(host.textContent).not.toContain("deploy.mdx");
		expect(host.querySelectorAll("button")).toHaveLength(1);
	});
});

describe("Tooltip", () => {
	it("is the web's tippy target: a focusable dotted span in the line", () => {
		draw(
			<p>
				Hover{" "}
				<Tooltip content="Explained." placement="top" delay={100}>
					this
				</Tooltip>
				.
			</p>,
		);
		const target = host.querySelector<HTMLSpanElement>("p > span.cursor-help")!;
		expect(target.textContent).toBe("this");
		expect(target.tabIndex).toBe(0);
		expect(target.className).toContain("decoration-dotted");
	});
});

describe("Screenshot", () => {
	it("is a figure with the image, a caption and an expand button that opens the caller's view", () => {
		const renderExpanded = vi.fn(() => null);
		draw(
			<Screenshot
				id="shot"
				src="./assets/reader.png"
				alt="The reader"
				title="mdxserve"
				caption="The reader view."
				renderExpanded={renderExpanded}
			/>,
		);
		const figure = host.querySelector("figure")!;
		expect(figure.querySelector("img")!.getAttribute("src")).toBe("./assets/reader.png");
		expect(figure.querySelector("img")!.getAttribute("alt")).toBe("The reader");
		expect(figure.querySelector("figcaption")!.textContent).toBe("The reader view.");
		const expand = figure.querySelector<HTMLButtonElement>('button[title="Expand screenshot"]')!;
		expect(renderExpanded).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }));
		act(() => expand.click());
		expect(renderExpanded).toHaveBeenLastCalledWith(
			expect.objectContaining({ open: true, src: "./assets/reader.png", title: "mdxserve" }),
		);
	});
});
