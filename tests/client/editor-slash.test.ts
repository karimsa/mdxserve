// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { afterEach, describe, expect, it, vi } from "vitest";
import { builtins } from "../../client/builtins";
import { MdxBlock } from "../../client/editor/mdx-block";
import {
	blockContent,
	insertSlashBlock,
	matchingBlocks,
	slashBlocks,
} from "../../client/editor/blocks";
import { blockSlash } from "../../client/editor/slash";

let editor: Editor | undefined;
afterEach(() => {
	editor?.destroy();
	document.querySelector(".block-slash-menu")?.remove();
});

function open(
	source = "/",
	callbacks?: {
		diagram?: (range: { from: number; to: number }) => void;
		image?: (range: { from: number; to: number }) => void;
		link?: (range: { from: number; to: number }) => void;
		diagramEnabled?: boolean;
	},
) {
	editor = new Editor({
		extensions: [
			blockSlash(
				() => callbacks?.diagramEnabled ?? true,
				callbacks?.diagram ?? (() => {}),
				callbacks?.image ?? (() => {}),
				callbacks?.link,
			),
			StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
			TaskList,
			TaskItem,
			TableKit,
			Image,
			Markdown,
			MdxBlock,
		],
		contentType: "markdown",
		content: source,
	});
	return editor;
}

function insert(blockId: string) {
	const instance = open("/");
	const block = slashBlocks.find((item) => item.id === blockId)!;
	expect(insertSlashBlock(instance, { from: 1, to: 2 }, block)).toBe(true);
	return instance;
}

describe("slash block insertion", () => {
	it.each([
		["paragraph", "Text"],
		["link", "[Link text](https://example.com)"],
		["heading1", "# Heading"],
		["heading2", "## Heading"],
		["heading3", "### Heading"],
		["heading4", "#### Heading"],
		["heading5", "##### Heading"],
		["heading6", "###### Heading"],
		["bulletList", "- List item"],
		["orderedList", "1. List item"],
		["taskList", "- [ ] Task"],
		["blockquote", "> Quote"],
		["codeBlock", "```"],
		["table", "| Column 1"],
		["horizontalRule", "---"],
		["mermaid", "```mermaid"],
	])("inserts %s as valid Markdown", (blockId, expected) => {
		const instance = insert(blockId);
		expect(instance.getMarkdown()).toContain(expected);
		expect(instance.getMarkdown()).not.toContain("/\n");
	});

	it("keeps content before and after an insertion", () => {
		const instance = open("Before\n\n/\n\nAfter");
		expect(
			insertSlashBlock(
				instance,
				{ from: 9, to: 10 },
				slashBlocks.find((block) => block.id === "heading2")!,
			),
		).toBe(true);
		expect(instance.getMarkdown()).toContain("Before\n\n## Heading\n\nAfter");
	});

	it("rejects stale ranges and paragraphs with other text", () => {
		const instance = open("Intro /");
		expect(insertSlashBlock(instance, { from: 7, to: 8 }, slashBlocks[0])).toBe(false);
		expect(instance.getMarkdown()).toBe("Intro /");
	});

	it("has an editable MDX source template for every builtin", () => {
		const covered = new Set(
			slashBlocks.filter((block) => block.kind === "component").map((block) => block.label),
		);
		for (const builtin of builtins) {
			expect(covered.has(builtin.name), builtin.name).toBe(true);
			const block = slashBlocks.find((item) => item.label === builtin.name)!;
			expect(block.template).toContain(`<${builtin.name}`);
			const instance = insert(block.id);
			expect(instance.getJSON().content?.[0]?.type).toBe("mdxBlock");
			expect(instance.getMarkdown()).toContain(
				block.id === "datatable" ? '<DataTable id="table-' : block.template!,
			);
			instance.destroy();
		}
	});

	it("reopens every saved component as the same editable source block", () => {
		for (const block of slashBlocks.filter((item) => item.kind === "component")) {
			const instance = insert(block.id);
			const source = instance.getJSON().content?.[0]?.attrs?.source;
			const markdown = instance.getMarkdown();
			instance.destroy();
			const reopened = open(markdown);
			expect(reopened.getJSON().content?.[0]?.type, block.label).toBe("mdxBlock");
			expect(reopened.getJSON().content?.[0]?.attrs?.source, block.label).toBe(source);
			reopened.destroy();
		}
	});

	it("wraps Tab and Option in valid parents", () => {
		for (const name of ["Tab", "Option"]) {
			const source = blockContent(slashBlocks.find((block) => block.label === name)!).attrs as {
				source: string;
			};
			expect(source.source).toContain(name === "Tab" ? "<Tabs>" : "<Dropdown");
		}
	});
});

describe("slash menu", () => {
	it("matches labels, aliases and descriptions", () => {
		expect(matchingBlocks("h6").map((block) => block.id)).toContain("heading6");
		expect(matchingBlocks("to-do").map((block) => block.id)).toContain("taskList");
		expect(matchingBlocks("mdx").map((block) => block.label)).toContain("Custom component");
	});

	it("keeps a multiword query active", async () => {
		const instance = open("");
		instance.commands.focus();
		instance.commands.insertContent("/heading 2");
		await vi.waitFor(() =>
			expect(document.querySelector(".block-slash-option")?.textContent).toContain("Heading 2"),
		);
	});

	it("opens a grouped menu and uses arrows and Enter without losing editor focus", async () => {
		const instance = open("");
		instance.commands.focus();
		instance.commands.insertContent("/");
		await vi.waitFor(() => expect(document.querySelector(".block-slash-group")).not.toBeNull());
		const menu = document.querySelector<HTMLDivElement>(".block-slash-menu");
		expect(menu?.querySelectorAll(".block-slash-group").length).toBeGreaterThan(1);
		instance.view.dom.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
		);
		expect(menu?.querySelector('[aria-selected="true"]')?.textContent).toContain("Link");
		instance.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(instance.getMarkdown()).toContain("[Link text](https://example.com)");
		expect(document.querySelector(".block-slash-menu")).toBeNull();
	});

	it("leaves the slash text for dialog commands and Escape", async () => {
		let diagramRange: { from: number; to: number } | undefined;
		const instance = open("", {
			diagram: (range) => {
				diagramRange = range;
			},
		});
		instance.commands.focus();
		instance.commands.insertContent("/diagram");
		await vi.waitFor(() =>
			expect(document.querySelector(".block-slash-menu")?.textContent).toContain("Mermaid diagram"),
		);
		expect(document.querySelector(".block-slash-menu")?.textContent).toContain("Mermaid diagram");
		instance.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(diagramRange).toEqual({ from: 1, to: 9 });
		expect(instance.getMarkdown()).toBe("/diagram");
	});

	it.each(["image", "link"])("opens the %s dialog without deleting the trigger", async (kind) => {
		let opened: { from: number; to: number } | undefined;
		const callback = (range: { from: number; to: number }) => {
			opened = range;
		};
		const instance = open("", kind === "image" ? { image: callback } : { link: callback });
		instance.commands.focus();
		instance.commands.insertContent(`/${kind}`);
		await vi.waitFor(() => expect(document.querySelector(".block-slash-option")).not.toBeNull());
		instance.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(opened).toEqual({ from: 1, to: kind.length + 2 });
		expect(instance.getMarkdown()).toBe(`/${kind}`);
	});

	it("inserts Mermaid source when the diagram agent is disabled", async () => {
		const instance = open("", { diagramEnabled: false });
		instance.commands.focus();
		instance.commands.insertContent("/mermaid");
		await vi.waitFor(() => expect(document.querySelector(".block-slash-option")).not.toBeNull());
		instance.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		expect(instance.getMarkdown()).toContain("```mermaid");
	});

	it("dismisses on Escape and leaves the typed query intact", async () => {
		const instance = open("");
		const wrapper = document.createElement("div");
		wrapper.append(instance.view.dom);
		let escapedToEditor = 0;
		wrapper.addEventListener("keydown", (event) => {
			if (event.key === "Escape") escapedToEditor++;
		});
		instance.commands.focus();
		instance.commands.insertContent("/heading");
		await vi.waitFor(() => expect(document.querySelector(".block-slash-option")).not.toBeNull());
		instance.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(document.querySelector(".block-slash-menu")).toBeNull();
		expect(instance.getMarkdown()).toBe("/heading");
		expect(escapedToEditor).toBe(0);
		instance.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(escapedToEditor).toBe(1);
		instance.commands.clearContent();
		instance.commands.insertContent("/");
		await vi.waitFor(() => expect(document.querySelector(".block-slash-option")).not.toBeNull());
		wrapper.remove();
	});
});
