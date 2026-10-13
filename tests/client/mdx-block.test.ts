// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { EditorContent } from "@tiptap/react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { MdxBlock } from "../../client/editor/mdx-block";

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function open(source: string): Editor {
	editor = new Editor({
		extensions: [StarterKit, Markdown, MdxBlock],
		contentType: "markdown",
		content: source,
	});
	return editor;
}

it("preserves a nested JSX component and its expressions without taking following Markdown", () => {
	const component = [
		'<Callout tone={theme.name} title="A > B">',
		"  <Badge value={{ count: 2 }}>nested</Badge>",
		"  {items.map((item) => <Button key={item}>{item}</Button>)}",
		"</Callout>",
	].join("\n");
	const instance = open(`Before\n\n${component}\n\n## After\n\nFollowing paragraph`);
	const blocks = instance.getJSON().content ?? [];
	expect(blocks.map((block) => block.type)).toEqual([
		"paragraph",
		"mdxBlock",
		"heading",
		"paragraph",
	]);
	expect(blocks[1].attrs?.source).toBe(component);
	expect(instance.getMarkdown()).toContain(`${component}\n\n## After`);
	expect(instance.getMarkdown()).toContain("Following paragraph");
});

it("serializes inserted and edited source as raw MDX", () => {
	const instance = open("Before");
	const source = '<Callout tone="info">{value}</Callout>';
	instance.commands.insertContentAt(instance.state.doc.content.size, {
		type: "mdxBlock",
		attrs: { source },
	});
	expect(instance.getMarkdown()).toContain(source);
	let blockPosition = -1;
	instance.state.doc.descendants((node, position) => {
		if (node.type.name === "mdxBlock") blockPosition = position;
	});
	expect(blockPosition).toBeGreaterThanOrEqual(0);
	instance.commands.setNodeSelection(blockPosition);
	instance.commands.updateAttributes("mdxBlock", { source: '<Card title="Updated" />' });
	expect(instance.getMarkdown()).toContain('<Card title="Updated" />');
});

it("keeps adjacent components distinct from each other and following text", () => {
	const instance = open('<Card title="A" />\n\n<Badge>{count}</Badge>\n\nAfter');
	expect(instance.getJSON().content?.map((block) => block.type)).toEqual([
		"mdxBlock",
		"mdxBlock",
		"paragraph",
	]);
	expect(instance.getMarkdown()).toContain('<Card title="A" />\n\n<Badge>{count}</Badge>\n\nAfter');
});

it("preserves permitted leading indentation on a flow component", () => {
	const source = "  <Callout>\n  text\n  </Callout>\n\nAfter";
	const instance = open(source);
	expect(instance.getJSON().content?.[0]?.type).toBe("mdxBlock");
	expect(instance.getJSON().content?.[0]?.attrs?.source).toBe("  <Callout>\n  text\n  </Callout>");
	expect(instance.getMarkdown()).toContain("After");
});

it("recognizes JSX even when later tolerant Markdown is not valid MDX", () => {
	const instance = open('<Card title="A" />\n\nUnclosed {');
	expect(instance.getJSON().content?.[0]).toMatchObject({
		type: "mdxBlock",
		attrs: { source: '<Card title="A" />' },
	});
	expect(instance.getMarkdown()).toContain("Unclosed {");
});

it("edits the component through its labeled source field", async () => {
	const instance = open('<Card title="Before" />');
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(createElement(EditorContent, { editor: instance })));
		const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="MDX source"]');
		expect(field?.value).toBe('<Card title="Before" />');
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			setter?.call(field, '<Card title="After" />');
			field?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(instance.getMarkdown()).toContain('<Card title="After" />');
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

it("does not classify ordinary Markdown containing an angle bracket as a component", () => {
	const instance = open("A < B and C > D\n\nAfter");
	expect(instance.getJSON().content?.some((block) => block.type === "mdxBlock")).toBe(false);
});

it("keeps the human text field focused while clearing and replacing component content", async () => {
	const instance = open('<Callout title="Note">\n  Starter text\n</Callout>');
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(createElement(EditorContent, { editor: instance })));
		const field = host.querySelector<HTMLTextAreaElement>(".mdx-component-fields textarea")!;
		field.focus();
		for (const value of ["", "Literal {braces} and <tags>"]) {
			await act(async () => {
				Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
					field,
					value,
				);
				field.dispatchEvent(new Event("input", { bubbles: true }));
			});
			expect(document.activeElement).toBe(field);
			expect(field.value).toBe(value);
		}
		expect(instance.getMarkdown()).toContain('{"Literal {braces} and <tags>"}');
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});
