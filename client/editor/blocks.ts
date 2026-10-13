import type { Editor, Range } from "@tiptap/core";

export type BlockGroup = "Basic blocks" | "Media and structure" | "Components";
export interface SlashBlock {
	id: string;
	label: string;
	description: string;
	aliases: string[];
	group: BlockGroup;
	kind: "native" | "component" | "diagram" | "image";
	template?: string;
}

const native = (
	id: string,
	label: string,
	description: string,
	aliases: string[] = [],
): SlashBlock => ({
	id,
	label,
	description,
	aliases,
	group: "Basic blocks",
	kind: "native",
});
const component = (
	label: string,
	description: string,
	template: string,
	aliases: string[] = [],
): SlashBlock => ({
	id: label.toLowerCase().replace(/\s+/g, "-"),
	label,
	description,
	aliases,
	group: "Components",
	kind: "component",
	template,
});

export const slashBlocks: SlashBlock[] = [
	native("paragraph", "Text", "Plain paragraph", ["paragraph", "body"]),
	native("link", "Link", "Text linked to a web address", ["url", "hyperlink"]),
	...Array.from({ length: 6 }, (_, index) =>
		native(`heading${index + 1}`, `Heading ${index + 1}`, `Level ${index + 1} heading`, [
			`h${index + 1}`,
			`title ${index + 1}`,
		]),
	),
	native("bulletList", "Bulleted list", "List with bullet points", ["unordered", "bullets"]),
	native("orderedList", "Numbered list", "List with numbered steps", ["ordered", "numbers"]),
	native("taskList", "To-do list", "Checklist with boxes", ["todo", "checkbox", "tasks"]),
	native("blockquote", "Quote", "Indented quotation", ["blockquote", "citation"]),
	{
		...native("codeBlock", "Code", "Fenced code block", ["snippet", "preformatted"]),
		group: "Media and structure",
	},
	{
		...native("table", "Table", "Three-column Markdown table", ["grid", "rows"]),
		group: "Media and structure",
	},
	{
		...native("horizontalRule", "Divider", "Horizontal rule", ["rule", "separator", "hr"]),
		group: "Media and structure",
	},
	{
		id: "image",
		label: "Image",
		description: "Add an image URL and alt text",
		aliases: ["photo", "picture"],
		group: "Media and structure",
		kind: "image",
	},
	{
		id: "mermaid",
		label: "Mermaid diagram",
		description: "Create a diagram or edit Mermaid source",
		aliases: ["diagram", "flowchart", "sequence"],
		group: "Media and structure",
		kind: "diagram",
	},
	component(
		"Custom component",
		"Editable MDX or JSX source",
		'<Callout title="Custom component">\n  Edit this MDX source.\n</Callout>',
		["mdx", "jsx", "source", "component"],
	),
	component(
		"Callout",
		"Highlighted note or warning",
		'<Callout title="Note">\n  Add your note here.\n</Callout>',
		["note", "warning", "tip"],
	),
	component(
		"Button",
		"Link styled as a button",
		'<Button href="https://example.com">\n  Open link\n</Button>',
		["link", "action"],
	),
	component(
		"Tooltip",
		"Hover explanation for text",
		'<Tooltip content="More information">\n  Explained term\n</Tooltip>',
		["hint", "hover"],
	),
	component(
		"Tabs",
		"Tabbed content panels",
		'<Tabs>\n  <Tab label="First">First panel</Tab>\n  <Tab label="Second">Second panel</Tab>\n</Tabs>',
		["panels"],
	),
	component(
		"Tab",
		"A tab inside Tabs",
		'<Tabs>\n  <Tab label="First">First panel</Tab>\n  <Tab label="Second">Second panel</Tab>\n</Tabs>',
		["panel"],
	),
	component("Badge", "Small status label", '<Badge tone="ok">\n  Ready\n</Badge>', [
		"status",
		"pill",
	]),
	component(
		"Diff",
		"Before and after code",
		'<Diff before="old value" after="new value" language="text" />',
		["changes", "compare"],
	),
	component(
		"Card",
		"Featured content card",
		'<Card title="Next step" description="Learn more about this topic" href="https://example.com" />',
		["feature", "link card"],
	),
	component(
		"CardGrid",
		"Responsive group of cards",
		'<CardGrid>\n  <Card title="First" description="First option" />\n  <Card title="Second" description="Second option" />\n</CardGrid>',
		["cards", "grid"],
	),
	component("Kbd", "Keyboard shortcut key", "<Kbd>\n  ⌘\n</Kbd>", ["key", "keyboard"]),
	component(
		"FileTree",
		"Directory layout",
		'<FileTree nodes={[{ name: "src", children: [{ name: "index.ts" }] }]} />',
		["files", "folder"],
	),
	component(
		"Chart",
		"Small data chart",
		'<Chart data={[{ label: "First", value: 3 }, { label: "Second", value: 5 }]} />',
		["graph", "bar chart"],
	),
	component("Sparkline", "Inline trend line", "<Sparkline values={[2, 3, 5, 4, 7]} />", [
		"trend",
		"line",
	]),
	component(
		"Dropdown",
		"Picker with choices",
		'<Dropdown label="Choose one" options={["First", "Second"]} />',
		["select", "menu"],
	),
	component(
		"Option",
		"A panel inside Dropdown",
		'<Dropdown label="Choose one">\n  <Option label="First">First panel</Option>\n  <Option label="Second">Second panel</Option>\n</Dropdown>',
		["choice"],
	),
	component(
		"DataTable",
		"Sortable data table",
		'<DataTable id="example-table" columns={[{ key: "name", label: "Name", type: "text" }, { key: "value", label: "Value", type: "number" }]} data={[{ name: "First", value: 3 }, { name: "Second", value: 5 }]} />',
		["dataset", "sortable table"],
	),
	component(
		"Screenshot",
		"App screenshot in a window",
		'<Screenshot src="/screenshot.png" alt="Description of the screenshot" title="Example" />',
		["window", "screen capture"],
	),
];

export function matchingBlocks(query: string): SlashBlock[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	return slashBlocks.filter((block) =>
		terms.every(
			(term) =>
				[block.label, ...block.aliases].some((value) => value.toLowerCase().includes(term)) ||
				block.description
					.toLowerCase()
					.split(/\W+/)
					.some((word) => word.startsWith(term)),
		),
	);
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

export function blockContent(block: SlashBlock): Record<string, unknown> {
	if (block.kind === "component") return { type: "mdxBlock", attrs: { source: block.template } };
	if (block.id.startsWith("heading"))
		return {
			type: "heading",
			attrs: { level: Number(block.id.slice(-1)) },
			content: [{ type: "text", text: "Heading" }],
		};
	switch (block.id) {
		case "paragraph":
			return paragraph("Text");
		case "link":
			return {
				type: "paragraph",
				content: [
					{
						type: "text",
						text: "Link text",
						marks: [{ type: "link", attrs: { href: "https://example.com" } }],
					},
				],
			};
		case "bulletList":
			return {
				type: "bulletList",
				content: [{ type: "listItem", content: [paragraph("List item")] }],
			};
		case "orderedList":
			return {
				type: "orderedList",
				content: [{ type: "listItem", content: [paragraph("List item")] }],
			};
		case "taskList":
			return {
				type: "taskList",
				content: [{ type: "taskItem", attrs: { checked: false }, content: [paragraph("Task")] }],
			};
		case "blockquote":
			return { type: "blockquote", content: [paragraph("Quote")] };
		case "codeBlock":
			return { type: "codeBlock", content: [{ type: "text", text: "Code" }] };
		case "table":
			return {
				type: "table",
				content: [
					{
						type: "tableRow",
						content: ["Column 1", "Column 2", "Column 3"].map((value) => ({
							type: "tableHeader",
							content: [paragraph(value)],
						})),
					},
					{
						type: "tableRow",
						content: ["Value 1", "Value 2", "Value 3"].map((value) => ({
							type: "tableCell",
							content: [paragraph(value)],
						})),
					},
				],
			};
		case "horizontalRule":
			return { type: "horizontalRule" };
		case "mermaid":
			return {
				type: "codeBlock",
				attrs: { language: "mermaid" },
				content: [{ type: "text", text: "flowchart TD\n  A[Start] --> B[End]" }],
			};
		default:
			throw new Error(`Unknown slash block: ${block.id}`);
	}
}

/** Replace the whole slash paragraph rather than nesting a block inside it. */
export function insertSlashBlock(editor: Editor, range: Range, block: SlashBlock): boolean {
	const { doc } = editor.state;
	if (range.to > doc.content.size) return false;
	const start = doc.resolve(range.from);
	if (
		start.parent.type.name !== "paragraph" ||
		start.parent.textContent !== doc.textBetween(range.from, range.to)
	)
		return false;
	if (block.kind === "image") return false;
	const replacement = { from: start.before(), to: start.after() };
	const content = blockContent(block);
	if (block.id === "datatable") {
		const identifier = `table-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
		(content.attrs as { source: string }).source = block.template!.replace(
			'id="example-table"',
			`id="${identifier}"`,
		);
	}
	return editor.chain().focus().insertContentAt(replacement, content).run();
}
