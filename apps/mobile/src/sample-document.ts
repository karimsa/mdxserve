import type { BlockNode } from "@mdxserve/client/document/tree-types";

const text = (value: string) => ({ type: "text", value }) as const;

/**
 * A short document as the server's `getDocument` sends it, with one of each node type the
 * renderers draw: the gallery's sample until the app reads documents from a server (phase 4).
 */
export const SAMPLE_DOCUMENT: BlockNode[] = [
	{
		type: "section",
		id: "markdown-tour",
		level: 1,
		heading: [text("Markdown tour")],
		children: [
			{
				type: "paragraph",
				children: [
					text("This page is "),
					{ type: "strong", children: [text("rendered natively")] },
					text(" from the "),
					{ type: "emphasis", children: [text("same")] },
					text(" tree the web client draws, with "),
					{ type: "inlineCode", value: "inline code" },
					text(", a "),
					{
						type: "link",
						href: "https://github.com/karimsa/mdxserve",
						title: null,
						children: [text("link")],
					},
					text(", a "),
					{ type: "element", id: null, tag: "kbd", attrs: {}, children: [text("⌘K")] },
					text(" key and a "),
					{
						type: "component",
						id: null,
						name: "Badge",
						props: { tone: "ok", variant: "soft", dot: true },
						children: [text("badge")],
					},
					text("."),
				],
			},
			{
				type: "section",
				id: "lists",
				level: 2,
				heading: [text("Lists")],
				children: [
					{
						type: "list",
						ordered: false,
						start: null,
						items: [
							{ checked: null, children: [{ type: "paragraph", children: [text("First item")] }] },
							{
								checked: null,
								children: [
									{
										type: "paragraph",
										children: [
											text("Second item, with "),
											{ type: "delete", children: [text("struck")] },
											text(" text"),
										],
									},
								],
							},
						],
					},
					{
						type: "list",
						ordered: true,
						start: 1,
						items: [
							{
								checked: true,
								children: [{ type: "paragraph", children: [text("Install mdxserve")] }],
							},
							{
								checked: false,
								children: [{ type: "paragraph", children: [text("Open a folder")] }],
							},
						],
					},
				],
			},
			{
				type: "section",
				id: "blocks",
				level: 2,
				heading: [text("Blocks")],
				children: [
					{
						type: "blockquote",
						children: [{ type: "paragraph", children: [text("A quotation, set off by a rule.")] }],
					},
					{
						type: "code",
						id: null,
						lang: "ts",
						title: "server.ts",
						showLineNumbers: false,
						highlightLines: [],
						value: "const server = http.createServer(handler);\nserver.listen(4040);",
					},
					{
						type: "component",
						id: "callout-1",
						name: "Callout",
						props: { tone: "tip" },
						children: [{ type: "paragraph", children: [text("A builtin inside the document.")] }],
					},
					{ type: "thematicBreak" },
					{
						type: "tabs",
						id: "os",
						defaultValue: "mac",
						tabs: [
							{
								id: "os>mac",
								value: "mac",
								label: "macOS",
								children: [{ type: "paragraph", children: [text("brew install mdxserve")] }],
							},
							{
								id: "os>linux",
								value: "linux",
								label: "Linux",
								children: [
									{ type: "paragraph", children: [text("npm install -g @karimsa/mdxserve")] },
								],
							},
						],
					},
					{
						type: "table",
						id: "table-sizes",
						persist: false,
						align: [null, "right"],
						head: [[text("Release")], [text("Size")]],
						rows: [
							[[text("0.6.0")], [text("3.1 MB")]],
							[[text("0.7.0")], [text("4.4 MB")]],
						],
					},
					{ type: "component", id: null, name: "Mystery", props: {}, children: [] },
				],
			},
		],
	},
];
