import { describe, expect, it } from "vitest";
import { DocumentService } from "../../src/document/service.js";
import { parseFenceMeta } from "../../src/document/convert.js";
import { documentTreeSchema, type BlockNode } from "../../src/document/schema.js";
import type { DocumentDiagnostic } from "../../src/document/diagnostics.js";
import { builtinRegistry } from "../helpers/components.js";
import { findById, idsOf } from "./tree.js";

const service = new DocumentService(
	builtinRegistry,
	(relative, docPath) => `asset:${docPath}:${relative}`,
);

function parse(source: string, docPath = "/docs/guide.mdx") {
	const result = service.parse(source, docPath);
	expect(documentTreeSchema.parse(result.tree)).toEqual(result.tree);
	return result;
}

function codes(diagnostics: DocumentDiagnostic[]): string[] {
	return diagnostics.map((diagnostic) => diagnostic.code);
}

describe("DocumentService.parse — ids", () => {
	it("gives a section whose heading text is unique its slug", () => {
		const { tree, diagnostics } = parse("# Getting Started\n\nHello.\n\n## Install it now\n");
		expect(idsOf(tree)).toEqual(["getting-started", "install-it-now"]);
		expect(diagnostics).toEqual([]);
	});

	it("gives every heading in a repeating group its full path from the h1", () => {
		const { tree, diagnostics } = parse(
			"# Guide\n\n## Install\n\n### Examples\n\nOne.\n\n## Usage\n\n### Examples\n\nTwo.\n",
		);
		expect(idsOf(tree)).toEqual([
			"guide",
			"install",
			"guide>install>examples",
			"usage",
			"guide>usage>examples",
		]);
		expect(diagnostics).toEqual([]);
	});

	it("keeps the authored id of a stateful component and of details", () => {
		const { tree, diagnostics } = parse(
			'# Doc\n\n<Diff id="config-change" before="a" after="b" />\n\n<details id="more">\n<summary>More</summary>\n\nBody\n</details>\n',
		);
		expect(findById(tree, "config-change")).toMatchObject({ type: "component", name: "Diff" });
		expect(findById(tree, "more")).toMatchObject({ type: "element", tag: "details" });
		expect(diagnostics).toEqual([]);
	});

	it("gives a tab the Tabs id, >, and its value, which defaults to the slug of its label", () => {
		const { tree } = parse(
			'# Doc\n\n<Tabs id="os">\n  <Tab label="macOS (Intel)">\n    Mac.\n  </Tab>\n  <Tab label="Linux" value="gnu">\n    Linux.\n  </Tab>\n</Tabs>\n',
		);
		const tabs = findById(tree, "os");
		expect(tabs).toMatchObject({ type: "tabs", defaultValue: "macos-intel" });
		if (tabs && "tabs" in tabs) {
			expect(tabs.tabs.map((tab) => [tab.id, tab.value, tab.label])).toEqual([
				["os>macos-intel", "macos-intel", "macOS (Intel)"],
				["os>gnu", "gnu", "Linux"],
			]);
		}
	});

	it("gives other block builtins and mermaid blocks a positional id under their owner", () => {
		const { tree } = parse(
			"# Install\n\n<Callout>One</Callout>\n\n```mermaid\ngraph TD; A-->B\n```\n\n<Callout>Two</Callout>\n\nInline <Badge>beta</Badge>.\n",
		);
		expect(idsOf(tree)).toEqual([
			"install",
			"install>~callout-1",
			"install>~mermaid-1",
			"install>~callout-2",
		]);
		const paragraph = (findById(tree, "install") as Extract<BlockNode, { type: "section" }>)
			.children[3];
		expect(paragraph).toMatchObject({
			type: "paragraph",
			children: [
				{ type: "text" },
				{ type: "component", name: "Badge", id: null },
				{ type: "text" },
			],
		});
	});

	it("gives the content before the first heading the fixed id ~preamble", () => {
		const { tree, ranges } = parse(
			"---\ntitle: T\n---\n\nIntro.\n\n<Callout>Note</Callout>\n\n# Title\n",
		);
		expect(tree.children[0]).toMatchObject({ type: "preamble", id: "~preamble" });
		expect(idsOf(tree)).toEqual(["~preamble", "~preamble>~callout-1", "title"]);
		expect(ranges.get("~preamble")).toEqual({ startLine: 4, endLine: 8 });
		expect(tree.metadata.title).toBe("T");
	});

	it("has no preamble when the document starts with a heading", () => {
		const { tree } = parse("# Title\n\nText.\n");
		expect(tree.children.map((node) => node.type)).toEqual(["section"]);
	});
});

describe("DocumentService.parse — id fallbacks", () => {
	it("suffixes the second heading with the same text under the same parent", () => {
		const { tree, diagnostics } = parse("# Guide\n\n## Steps\n\nA\n\n## Steps\n\nB\n");
		expect(idsOf(tree)).toEqual(["guide", "guide>steps", "guide>steps>~2"]);
		expect(codes(diagnostics)).toEqual(["duplicate-heading"]);
		expect(diagnostics[0]).toMatchObject({ line: 7 });
		expect(diagnostics[0].message).toContain("first on line 3");
		expect(diagnostics[0].message).toContain("Rename one heading");
	});

	it("gives a stateful component with no id a positional id", () => {
		const { tree, diagnostics } = parse('# Data\n\n<Chart data={[{ label: "a", value: 1 }]} />\n');
		expect(idsOf(tree)).toEqual(["data", "data>~chart-1"]);
		expect(diagnostics).toMatchObject([{ code: "missing-id", component: "Chart", line: 3 }]);
		expect(diagnostics[0].message).toContain('Add id="…"');
	});

	it("gives details with no id a positional id", () => {
		const { tree, diagnostics } = parse("<details>\n<summary>S</summary>\n\nBody\n</details>\n");
		expect(idsOf(tree)).toContain("~preamble>~details-1");
		expect(codes(diagnostics)).toEqual(["missing-id"]);
	});

	it("keeps a repeated id on the first node and gives later ones a positional id", () => {
		const { tree, diagnostics } = parse(
			'# A\n\n<Diff id="change" before="a" after="b" />\n\n<FileTree id="change" nodes={[]} />\n',
		);
		expect(findById(tree, "change")).toMatchObject({ name: "Diff" });
		expect(findById(tree, "a>~filetree-1")).toMatchObject({ name: "FileTree" });
		expect(diagnostics).toMatchObject([{ code: "duplicate-id", line: 5 }]);
		expect(diagnostics[0].message).toContain("line 3");
		expect(diagnostics[0].message).toContain("line 5");
	});

	it("keeps a Markdown table's id when a component or heading uses the same id", () => {
		const table = "| Name |\n| - |\n| a |\n";
		const tableId = (parse(table).tree.children[0] as { children: { id: string }[] }).children[0]
			.id;
		const { tree, diagnostics } = parse(
			`${table}\n<details id="${tableId}">\n<summary>S</summary>\n\nBody\n</details>\n`,
		);
		const ids = idsOf(tree);
		expect(new Set(ids).size).toBe(ids.length);
		expect(findById(tree, tableId)).toMatchObject({ type: "table" });
		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["duplicate-id"]);
		expect(diagnostics[0].message).toContain("Markdown table");

		// A heading whose slug spells the table's id gets a suffixed id instead.
		const withHeading = parse(`${table}\n# ${tableId}\n`).tree;
		const headingIds = idsOf(withHeading);
		expect(new Set(headingIds).size).toBe(headingIds.length);
		expect(findById(withHeading, tableId)).toMatchObject({ type: "table" });
	});

	it("lets a heading keep an id that a component also claims", () => {
		const { tree, diagnostics } = parse('# Setup\n\n<Diff id="setup" before="a" after="b" />\n');
		expect(idsOf(tree)).toEqual(["setup", "setup>~diff-1"]);
		expect(codes(diagnostics)).toEqual(["id-conflicts-with-heading"]);
	});

	it("rejects an id that does not match the pattern", () => {
		const { tree, diagnostics } = parse('# A\n\n<Diff id="1 bad" before="a" after="b" />\n');
		expect(idsOf(tree)).toEqual(["a", "a>~diff-1"]);
		expect(codes(diagnostics)).toEqual(["invalid-id"]);
		expect(diagnostics[0].message).toContain("starting with a letter");
	});

	it("gives a repeated tab value a generated one", () => {
		const { tree, diagnostics } = parse(
			'<Tabs id="pick">\n  <Tab label="A" value="x">\n    a\n  </Tab>\n  <Tab label="B" value="x">\n    b\n  </Tab>\n</Tabs>\n',
		);
		const tabs = findById(tree, "pick");
		expect(tabs && "tabs" in tabs ? tabs.tabs.map((tab) => tab.id) : []).toEqual([
			"pick>x",
			"pick>~2",
		]);
		expect(codes(diagnostics)).toEqual(["duplicate-tab-value"]);
	});

	it("holds an authored tab value to the id pattern and falls back to the label slug", () => {
		const { tree, diagnostics } = parse(
			'<Tabs id="t1">\n  <Tab label="One" value="x>y">\n    a\n  </Tab>\n  <Tab label="Two" value="one">\n    b\n  </Tab>\n  <Tab label="Three" value="9lives">\n    c\n  </Tab>\n</Tabs>\n',
		);
		const tabs = findById(tree, "t1");
		expect(tabs && "tabs" in tabs ? tabs.tabs.map((tab) => tab.id) : []).toEqual([
			"t1>one",
			"t1>~2",
			"t1>three",
		]);
		expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.prop])).toEqual([
			["invalid-id", "value"],
			["duplicate-tab-value", "value"],
			["invalid-id", "value"],
		]);
		expect(diagnostics[0].message).toContain("starting with a letter");
	});

	it("selects the first tab when defaultValue matches none, listing the values", () => {
		const { tree, diagnostics } = parse(
			'<Tabs id="pick" defaultValue="z">\n  <Tab label="A">\n    a\n  </Tab>\n  <Tab label="B">\n    b\n  </Tab>\n</Tabs>\n',
		);
		expect(findById(tree, "pick")).toMatchObject({ defaultValue: "a" });
		expect(codes(diagnostics)).toEqual(["invalid-tab-default"]);
		expect(diagnostics[0].message).toContain('"a", "b"');
	});
});

describe("DocumentService.parse — fallback parse", () => {
	const source = [
		"# Guide", // 1
		"", // 2
		"Intro.", // 3
		"", // 4
		"## Broken", // 5
		"", // 6
		"Some {1 +} text.", // 7
		"", // 8
		"## Fine", // 9
		"", // 10
		"Still here.", // 11
		"",
	].join("\n");

	it("keeps every h1/h2 section that parses and shows the failed one as source", () => {
		const { tree, diagnostics, ranges } = parse(source);
		const guide = tree.children[0] as Extract<BlockNode, { type: "section" }>;
		expect(guide.id).toBe("guide");
		expect(guide.children.map((node) => node.type)).toEqual(["paragraph", "error", "section"]);
		expect(guide.children[1]).toMatchObject({
			type: "error",
			id: "broken",
			source: "## Broken\n\nSome {1 +} text.\n\n",
		});
		expect(guide.children[2]).toMatchObject({ type: "section", id: "fine" });
		expect(diagnostics).toMatchObject([{ code: "mdx-syntax", severity: "error", line: 7 }]);
		expect(diagnostics[0].message).toContain("Fix the syntax at line 7");
		expect(ranges.get("broken")).toEqual({ startLine: 5, endLine: 8 });
		expect(ranges.get("guide")).toEqual({ startLine: 1, endLine: 4 });
		expect(ranges.get("fine")).toEqual({ startLine: 9, endLine: 11 });
	});

	it("lists a failed h2 section in the table of contents, in document order", () => {
		const { tree } = parse("## Good\n\nfine\n\n## Broken\n\n{1 +}\n\n## After\n\nok\n");
		expect(tree.toc).toEqual([
			{ id: "good", label: "Good", kind: "heading", children: [] },
			{ id: "broken", label: "Broken", kind: "heading", children: [] },
			{ id: "after", label: "After", kind: "heading", children: [] },
		]);
	});

	it.each([
		["a stray {", "text {"],
		["an unclosed <Callout", "<Callout"],
		["an unclosed inline code run", "text `` open {"],
	])("keeps %s in its own section, so later sections still escape a bare <", (_, broken) => {
		const source = `## A\n\n${broken}\n\n## B\n\nx < 5\n\n## C\n\nfine\n`;
		const { tree, diagnostics } = parse(source);
		expect(tree.children.map((node) => [node.type, (node as { id: string }).id])).toEqual([
			["error", "a"],
			["section", "b"],
			["section", "c"],
		]);
		expect(JSON.stringify(tree.children[1])).toContain('"value":"x < 5"');
		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["mdx-syntax"]);
		expect(diagnostics[0].line).toBeGreaterThanOrEqual(1);
		expect(diagnostics[0].line).toBeLessThanOrEqual(4);
	});

	it("makes a document with no h1 or h2 one failed chunk", () => {
		const { tree, diagnostics } = parse("Text {1 +}\n\n### Deep\n");
		expect(tree.children).toMatchObject([{ type: "error", id: "~error-1" }]);
		expect(codes(diagnostics)).toEqual(["mdx-syntax"]);
	});

	it("does not split at a heading inside a code fence or the frontmatter", () => {
		const { tree } = parse(
			"---\ntitle: x\n# not a heading\n---\n\n```sh\n# comment\n```\n\n{oops\n",
		);
		expect(tree.children).toMatchObject([{ type: "error", id: "~error-1" }]);
	});

	it("reports an unclosed tag at the line it starts", () => {
		const { diagnostics } = parse("# A\n\n<Callout>\n\nunclosed\n");
		expect(diagnostics).toMatchObject([{ code: "mdx-syntax", line: 3 }]);
	});
});

describe("DocumentService.parse — ranges", () => {
	it("ends an h1/h2 section before the next h1/h2 and a deeper one before the next of its level", () => {
		const { ranges } = parse("# A\n\nx\n\n### Deep\n\ny\n\n## B\n\n### C\n\nz\n\n#### D\n\nw\n");
		expect(ranges.get("a")).toEqual({ startLine: 1, endLine: 8 });
		expect(ranges.get("deep")).toEqual({ startLine: 5, endLine: 8 });
		expect(ranges.get("b")).toEqual({ startLine: 9, endLine: 17 });
		expect(ranges.get("c")).toEqual({ startLine: 11, endLine: 17 });
		expect(ranges.get("d")).toEqual({ startLine: 15, endLine: 17 });
	});

	it("gives a mermaid block, a block builtin and Tabs their own lines", () => {
		const { ranges } = parse(
			'# A\n\n```mermaid\ngraph TD\n```\n\n<Callout>\n  x\n</Callout>\n\n<Tabs id="t">\n  <Tab label="One">\n    1\n  </Tab>\n</Tabs>\n',
		);
		expect(ranges.get("a>~mermaid-1")).toEqual({ startLine: 3, endLine: 5 });
		expect(ranges.get("a>~callout-1")).toEqual({ startLine: 7, endLine: 9 });
		expect(ranges.get("t")).toEqual({ startLine: 11, endLine: 15 });
	});
});

describe("DocumentService.parse — table of contents", () => {
	it("lists level 2 and 3 sections, tabs below their section, and tab-body headings below the tab", () => {
		const { tree } = parse(
			[
				"# Guide",
				"## Install",
				'<Tabs id="os">',
				'  <Tab label="Mac">',
				"    ## Homebrew",
				"    text",
				"    #### Upgrade",
				"    more",
				"  </Tab>",
				'  <Tab label="Linux">',
				"    linux",
				"  </Tab>",
				"</Tabs>",
				"### Verify",
				"#### Too deep",
				"## Next",
				"",
			].join("\n\n"),
		);
		expect(tree.toc).toEqual([
			{
				id: "install",
				label: "Install",
				kind: "heading",
				children: [
					{
						id: "os>mac",
						label: "Mac",
						kind: "tab",
						children: [
							{
								id: "homebrew",
								label: "Homebrew",
								kind: "heading",
								children: [{ id: "upgrade", label: "Upgrade", kind: "heading", children: [] }],
							},
						],
					},
					{ id: "os>linux", label: "Linux", kind: "tab", children: [] },
					{ id: "verify", label: "Verify", kind: "heading", children: [] },
				],
			},
			{ id: "next", label: "Next", kind: "heading", children: [] },
		]);
	});

	it("paths a heading repeated in two tabs from its tab", () => {
		const { tree, diagnostics } = parse(
			'# Doc\n\n<Tabs id="os">\n  <Tab label="Mac">\n    ## Install\n  </Tab>\n  <Tab label="Linux">\n    ## Install\n  </Tab>\n</Tabs>\n',
		);
		expect(idsOf(tree)).toEqual([
			"doc",
			"os",
			"os>mac",
			"os>mac>install",
			"os>linux",
			"os>linux>install",
		]);
		expect(diagnostics).toEqual([]);
	});
});

describe("DocumentService.parse — nodes", () => {
	it("reads fence meta into title, showLineNumbers and highlightLines", () => {
		const { tree } = parse('```ts title="app.ts" {1,3-4} showLineNumbers\na\nb\nc\nd\ne\n```\n');
		expect(tree.children[0]).toMatchObject({
			type: "preamble",
			children: [
				{
					type: "code",
					id: null,
					lang: "ts",
					title: "app.ts",
					showLineNumbers: true,
					highlightLines: [1, 3, 4],
					value: "a\nb\nc\nd\ne",
				},
			],
		});
	});

	it("caps highlighted lines to the block and ignores malformed ranges", () => {
		expect(parseFenceMeta("{2-99999999,x}", 3)).toEqual({
			title: null,
			showLineNumbers: false,
			highlightLines: [2, 3],
		});
		expect(parseFenceMeta("title='a b'", 1).title).toBe("a b");
		expect(parseFenceMeta(null, 1)).toEqual({
			title: null,
			showLineNumbers: false,
			highlightLines: [],
		});
	});

	it("rewrites a relative or absolute image path through the asset URL builder and leaves other URLs", () => {
		const { tree } = parse(
			'![a](./shot.png) ![b](https://example.com/b.png) ![c](/abs/c.png) ![d](//cdn.example/d.png)\n\n<img src="pic.png" alt="p" />\n',
		);
		const preamble = tree.children[0] as Extract<BlockNode, { type: "preamble" }>;
		expect(JSON.stringify(preamble)).toContain('"src":"asset:/docs/guide.mdx:./shot.png"');
		expect(JSON.stringify(preamble)).toContain('"src":"https://example.com/b.png"');
		expect(JSON.stringify(preamble)).toContain('"src":"asset:/docs/guide.mdx:/abs/c.png"');
		expect(JSON.stringify(preamble)).toContain('"src":"//cdn.example/d.png"');
		expect(JSON.stringify(preamble)).toContain('"src":"asset:/docs/guide.mdx:pic.png"');
		const shot = parse(
			'<Screenshot id="s" src="./s.png" alt="a" />\n<Screenshot id="t" src="https://x.dev/t.png" />\n',
		);
		expect(JSON.stringify(shot.tree)).toContain('"src":"asset:/docs/guide.mdx:./s.png"');
		expect(JSON.stringify(shot.tree)).toContain('"src":"https://x.dev/t.png"');
	});

	it("converts tables with the hash id and alignment", () => {
		const { tree } = parse("# T\n\n| a | b |\n|:-|-:|\n| 1 | **2** |\n");
		const section = tree.children[0] as Extract<BlockNode, { type: "section" }>;
		expect(section.children[0]).toMatchObject({
			type: "table",
			persist: true,
			align: ["left", "right"],
			head: [[{ type: "text", value: "a" }], [{ type: "text", value: "b" }]],
			rows: [
				[
					[{ type: "text", value: "1" }],
					[{ type: "strong", children: [{ type: "text", value: "2" }] }],
				],
			],
		});
		expect((section.children[0] as { id: string }).id).toMatch(/^markdown-table-v2-/);
	});

	it("resolves link references and keeps footnotes", () => {
		const { tree } = parse(
			'See [docs][d] and a note[^1].\n\n[d]: https://example.com "Docs"\n\n[^1]: The note.\n',
		);
		const text = JSON.stringify(tree);
		expect(text).toContain('{"type":"link","href":"https://example.com","title":"Docs"');
		expect(text).toContain('{"type":"footnoteReference","label":"1"}');
		expect(text).toContain('"type":"footnoteDefinition","label":"1"');
	});

	it("gives a footnote reference and its definition the same normalized label, whatever the case", () => {
		const { tree } = parse("Text[^NOTE].\n\n[^note]: Explanation\n");
		const labels: string[] = [];
		JSON.stringify(tree, (key, value) => {
			if (value && (value.type === "footnoteReference" || value.type === "footnoteDefinition"))
				labels.push(`${value.type}:${value.label}`);
			return value;
		});
		expect(labels).toEqual(["footnoteReference:note", "footnoteDefinition:note"]);
	});

	it("leaves no import, expression, script or unknown component in the tree", () => {
		const { tree, diagnostics } = parse(
			'import X from "./x.js"\n\n# Doc\n\n<Counter>kept</Counter> {1 + 1} <script>alert(1)</script>\n',
		);
		const text = JSON.stringify(tree);
		expect(text).not.toContain("import");
		expect(text).not.toContain("alert");
		expect(text).not.toContain("Counter");
		expect(text).toContain("kept");
		expect(codes(diagnostics).sort()).toEqual(
			[
				"esm-not-supported",
				"non-literal-expression",
				"unknown-component",
				"unsupported-element",
			].sort(),
		);
	});

	it("never throws, whatever the input", () => {
		for (const source of ["", "\r", "{", "<", "</x>", "# \n#", "```\n", "<Tabs>", "\u0000"]) {
			expect(() => parse(source)).not.toThrow();
		}
	});
});

describe("DocumentService.parse — invalid-prop, one per builtin", () => {
	const cases: [string, string, string][] = [
		["DataTable", '<DataTable id="t" columns="nope" data={[]} />', "columns"],
		["Callout", '<Callout tone="loud">x</Callout>', "tone"],
		["Tooltip", '<Tooltip content="c" delay="soon">x</Tooltip>', "delay"],
		[
			"Tabs",
			'<Tabs id="t" defaultValue={1}>\n  <Tab label="a">\n    a\n  </Tab>\n</Tabs>',
			"defaultValue",
		],
		["Tab", '<Tabs id="t">\n  <Tab label={1}>\n    a\n  </Tab>\n</Tabs>', "label"],
		["Badge", '<Badge variant="huge">x</Badge>', "variant"],
		["Diff", '<Diff id="d" before="a" after="b" context={-1} />', "context"],
		["Card", '<Card interactive="yes" />', "interactive"],
		["CardGrid", '<CardGrid columns="4">x</CardGrid>', "columns"],
		["FileTree", '<FileTree id="f" nodes={[{ path: "a" }]} />', "nodes"],
		["Chart", '<Chart id="c" orientation="diagonal" />', "orientation"],
		["Sparkline", '<Sparkline values={["a", "b"]} />', "values"],
		["Screenshot", '<Screenshot id="s" src="a.png" width={true} />', "width"],
	];

	it.each(cases)("drops a %s prop that fails its schema and reports it", (name, source, prop) => {
		const { tree, diagnostics } = parse(`${source}\n`);
		const invalid = diagnostics.filter((diagnostic) => diagnostic.code === "invalid-prop");
		expect(invalid).toHaveLength(1);
		expect(invalid[0]).toMatchObject({ severity: "error", component: name, prop });
		expect(invalid[0].message).toContain("Use ");
		if (name !== "Tab" && name !== "Tabs") {
			const node = JSON.stringify(tree);
			expect(node).not.toContain(`"${prop}":`);
		}
	});

	it("reports a missing required prop", () => {
		const { diagnostics } = parse('<Diff id="d" after="b" />\n');
		expect(diagnostics).toMatchObject([
			{ code: "invalid-prop", component: "Diff", prop: "before" },
		]);
	});

	it("has no invalid-prop case for Kbd, whose only prop is children", () => {
		const { diagnostics } = parse("<Kbd>K</Kbd>\n");
		expect(diagnostics).toEqual([]);
	});

	it("keeps only declared props, warning about each other one, key and ref included", () => {
		const { tree, diagnostics } = parse(
			'<Callout tone="tip" dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} ref="r" key="k">x</Callout>\n',
		);
		expect(
			diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity, diagnostic.prop]),
		).toEqual([
			["unknown-prop", "warning", "dangerouslySetInnerHTML"],
			["unknown-prop", "warning", "ref"],
			["unknown-prop", "warning", "key"],
		]);
		expect(JSON.stringify(tree)).toContain('"props":{"tone":"tip"}');
	});

	it("drops a Card link with an unsupported scheme from the tree", () => {
		const { tree, diagnostics } = parse('<Card title="x" href="javascript:alert(1)">card</Card>\n');
		expect(diagnostics).toMatchObject([{ code: "invalid-href", severity: "error" }]);
		expect(JSON.stringify(tree)).toContain('"props":{"title":"x"}');
	});

	it("warns about and drops a prop the builtin does not declare", () => {
		const { tree, diagnostics } = parse('<Badge tone="ok" sparkle>x</Badge>\n');
		expect(diagnostics).toMatchObject([
			{ code: "unknown-prop", severity: "warning", prop: "sparkle" },
		]);
		expect(JSON.stringify(tree)).toContain('"props":{"tone":"ok"}');
	});
});

describe("DocumentService.parse — block builtin content", () => {
	it("keeps the text of a one-line builtin inline, and wraps a multi-line body in a paragraph", () => {
		const { tree } = parse(
			'<Callout title="One">Inline **body**.</Callout>\n\n<Callout title="Two">\nBlock body.\n</Callout>\n',
		);
		const preamble = tree.children[0] as Extract<BlockNode, { type: "preamble" }>;
		const [one, two] = preamble.children as Extract<BlockNode, { type: "component" }>[];
		expect(one.children.map((child) => child.type)).toEqual(["text", "strong", "text"]);
		expect(two.children.map((child) => child.type)).toEqual(["paragraph"]);
	});
});
