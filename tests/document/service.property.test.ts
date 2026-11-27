import { describe, expect, it } from "vitest";
import fc from "fast-check";
import path from "node:path";
import { DocumentService, countLines } from "../../src/document/service.js";
import { documentTreeSchema } from "../../src/document/schema.js";
import { builtinPropSchemas } from "../../shared/builtins/index.js";
import { builtinRegistry } from "../helpers/components.js";
import { idNodes, idsOf, tocIds } from "./tree.js";

// Like the real builder, the URL depends on the directory of the document only.
const service = new DocumentService(
	builtinRegistry,
	(relative, docPath) => `${path.posix.dirname(docPath)}/${relative}`,
);

// ---- a generator of documents that exercise every node kind ---------------
// A small vocabulary makes repeated headings, ids and tab values likely.

const word = fc.constantFrom("install", "usage", "examples", "setup", "notes", "api");
const words = fc.array(word, { minLength: 1, maxLength: 3 }).map((chosen) => chosen.join(" "));
const authoredId = fc.option(fc.constantFrom("alpha", "beta", "install", "Bad id", "gamma"), {
	nil: undefined,
});
const idAttribute = (id: string | undefined) => (id === undefined ? "" : ` id="${id}"`);

const heading = fc
	.tuple(fc.integer({ min: 1, max: 4 }), words)
	.map(([level, text]) => `${"#".repeat(level)} ${text}`);
const paragraph = words.map((text) => `Some ${text} text with **bold** and \`code\`.`);
const list = fc
	.array(words, { minLength: 1, maxLength: 3 })
	.map((items) => items.map((item) => `- ${item}`).join("\n"));
const table = fc
	.tuple(word, word)
	.map(([left, right]) => `| ${left} | ${right} |\n| - | - |\n| 1 | 2 |`);
const mermaid = fc.constant("```mermaid\ngraph TD; A-->B\n```");
const fence = fc.constant('```ts title="a.ts" {1}\nconst a = 1;\n```');
const callout = words.map((text) => `<Callout title="${text}">\n  ${text}\n</Callout>`);
const badge = words.map((text) => `A <Badge tone="ok">${text}</Badge> inline.`);
const chart = authoredId.map(
	(id) => `<Chart${idAttribute(id)} data={[{ label: "a", value: 1 }]} />`,
);
const diff = authoredId.map((id) => `<Diff${idAttribute(id)} before="a" after="b" />`);
const details = authoredId.map(
	(id) => `<details${idAttribute(id)}>\n<summary>More</summary>\n\nBody\n</details>`,
);
const tabs = fc
	.tuple(
		authoredId,
		fc.array(fc.tuple(word, fc.option(heading, { nil: undefined })), {
			minLength: 1,
			maxLength: 3,
		}),
	)
	.map(
		([id, entries]) =>
			`<Tabs${idAttribute(id)}>\n${entries
				.map(
					([label, inner]) =>
						`  <Tab label="${label}">\n${inner === undefined ? "" : `    ${inner}\n\n`}    ${label} body\n  </Tab>`,
				)
				.join("\n")}\n</Tabs>`,
	);
const image = fc.constant("![shot](./shot.png)");

const wellFormedBlock = fc.oneof(
	{ weight: 4, arbitrary: heading },
	{ weight: 3, arbitrary: paragraph },
	list,
	table,
	mermaid,
	fence,
	callout,
	badge,
	chart,
	diff,
	details,
	tabs,
	image,
);
const brokenBlock = fc.constantFrom("Broken {1 +} block.", "<Callout>\n\nnever closed", "{");
const anyBlock = fc.oneof({ weight: 9, arbitrary: wellFormedBlock }, brokenBlock);

const frontmatter = fc.option(fc.constant("---\ntitle: Doc\n---\n"), { nil: "" });
const structuredDocument = fc
	.tuple(frontmatter, fc.array(anyBlock, { maxLength: 12 }))
	.map(([head, blocks]) => head + blocks.join("\n\n") + "\n");

/** Arbitrary strings, plus strings made of document syntax. */
const anySource = fc.oneof(
	structuredDocument,
	fc.string(),
	fc.string({
		unit: fc.constantFrom("#", " ", "\n", "<", ">", "{", "}", "`", "a", "/", "*", "|", "-"),
	}),
);

function parse(source: string, docPath = "/root/doc.mdx") {
	return service.parse(source, docPath);
}

describe("DocumentService.parse properties", () => {
	it("returns for any source string, and the tree passes the zod schema unchanged", () => {
		fc.assert(
			fc.property(anySource, (source) => {
				const { tree } = parse(source);
				expect(documentTreeSchema.parse(tree)).toEqual(tree);
			}),
		);
	});

	it("gives every node a unique id", () => {
		fc.assert(
			fc.property(anySource, (source) => {
				const ids = idsOf(parse(source).tree);
				expect(new Set(ids).size).toBe(ids.length);
			}),
		);
	});

	it("only lists toc entries whose id exists in the tree", () => {
		fc.assert(
			fc.property(anySource, (source) => {
				const { tree } = parse(source);
				const ids = new Set(idsOf(tree));
				for (const id of tocIds(tree.toc)) expect(ids.has(id)).toBe(true);
			}),
		);
	});

	it("keeps every range inside the file, and splicing a range with its own text reproduces the file", () => {
		fc.assert(
			fc.property(anySource, (source) => {
				const { ranges } = parse(source);
				const lineCount = countLines(source);
				// Lines with their own endings, so the splice below is byte-exact.
				const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
				for (const { startLine, endLine } of ranges.values()) {
					expect(startLine).toBeGreaterThanOrEqual(1);
					expect(endLine).toBeGreaterThanOrEqual(startLine);
					expect(endLine).toBeLessThanOrEqual(lineCount);
					const own = lines.slice(startLine - 1, endLine).join("");
					const spliced =
						lines.slice(0, startLine - 1).join("") + own + lines.slice(endLine).join("");
					expect(spliced).toBe(source);
				}
			}),
		);
	});

	it("gives the same tree for the same source as .md and as .mdx", () => {
		fc.assert(
			fc.property(anySource, (source) => {
				expect(parse(source, "/root/doc.md").tree).toEqual(parse(source, "/root/doc.mdx").tree);
			}),
		);
	});

	it("leaves every node below an inserted paragraph, and its id, unchanged", () => {
		fc.assert(
			fc.property(
				fc.array(wellFormedBlock, { minLength: 1, maxLength: 10 }),
				fc.nat(),
				(blocks, pick) => {
					const at = pick % (blocks.length + 1);
					const source = blocks.join("\n\n") + "\n";
					const inserted =
						[...blocks.slice(0, at), "An inserted paragraph.", ...blocks.slice(at)].join("\n\n") +
						"\n";
					// The line the block the paragraph goes above starts on, in `source`.
					const prefix = blocks.slice(0, at).join("\n\n");
					const blockLine = at === 0 ? 1 : prefix.split("\n").length + 2;
					const before = parse(source);
					const after = parse(inserted);
					const afterById = new Map(
						idNodes(after.tree).map((node) => [(node as { id: string }).id, node]),
					);
					for (const node of idNodes(before.tree)) {
						const id = (node as { id: string }).id;
						const range = before.ranges.get(id);
						// The preamble holds the insertion when it goes above the first block.
						if (!range || range.startLine < blockLine || id === "~preamble") continue;
						expect(afterById.get(id)).toEqual(node);
					}
				},
			),
		);
	});

	it("keeps a component's props to the keys its schema declares, whatever extra props it is given", () => {
		const names = Object.keys(builtinPropSchemas).filter(
			(name) => name !== "Tabs" && name !== "Tab",
		);
		const propName = fc.oneof(
			fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,11}$/),
			fc.constantFrom("key", "ref", "children", "id", "dangerouslySetInnerHTML", "tone", "href"),
		);
		const propValue = fc.oneof(
			fc.constantFrom('"x"', "{1}", "{true}", '{{ __html: "<b>x</b>" }}', "{[1, 2]}"),
			fc.constant(""),
		);
		fc.assert(
			fc.property(
				fc.constantFrom(...names),
				fc.uniqueArray(fc.tuple(propName, propValue), { selector: ([name]) => name, maxLength: 5 }),
				(name, extra) => {
					const attributes = extra
						.map(([prop, value]) => (value === "" ? prop : `${prop}=${value}`))
						.join(" ");
					const { tree } = parse(`<${name} ${attributes}>x</${name}>\n`);
					const declared = Object.keys(builtinPropSchemas[name].shape);
					const found: { props: Record<string, unknown> }[] = [];
					const collect = (value: unknown) => {
						if (Array.isArray(value)) value.forEach(collect);
						else if (value !== null && typeof value === "object") {
							const record = value as Record<string, unknown>;
							if (record.type === "component" && record.name === name)
								found.push(record as { props: Record<string, unknown> });
							Object.values(record).forEach(collect);
						}
					};
					collect(JSON.parse(JSON.stringify(tree)));
					expect(found.length).toBeGreaterThan(0);
					for (const node of found) {
						for (const key of Object.keys(node.props)) expect(declared).toContain(key);
					}
				},
			),
		);
	});

	it("loses no text inside Tabs, and reports content that is not in a labelled Tab", () => {
		// Each part carries a marker that must reach the tree, wherever it sits.
		const part = fc.constantFrom(
			"tab",
			"unlabelled-tab",
			"stray-paragraph",
			"stray-callout",
			"stray-unknown",
			"nested-tab",
		);
		const render = (kind: string, marker: string): string => {
			switch (kind) {
				case "tab":
					return `<Tab label="${marker}">\n\n${marker} body\n\n</Tab>`;
				case "unlabelled-tab":
					return `<Tab>\n\n${marker} body\n\n</Tab>`;
				case "stray-paragraph":
					return `${marker} body`;
				case "stray-callout":
					return `<Callout title="t">${marker} body</Callout>`;
				case "stray-unknown":
					return `<Widget>${marker} body</Widget>`;
				default:
					return `> <Tab label="${marker}">${marker} body</Tab>`;
			}
		};
		fc.assert(
			fc.property(
				fc.array(part, { minLength: 1, maxLength: 6 }),
				fc.constantFrom("/root/doc.md", "/root/doc.mdx"),
				(kinds, docPath) => {
					const markers = kinds.map((_, position) => `marker${position}`);
					const source = `<Tabs id="pick">\n\n${kinds
						.map((kind, position) => render(kind, markers[position]))
						.join("\n\n")}\n\n</Tabs>\n`;
					const { tree, diagnostics } = parse(source, docPath);
					const text = JSON.stringify(tree);
					for (const marker of markers) expect(text).toContain(`${marker} body`);
					const tabs = idNodes(tree).find((node) => "type" in node && node.type === "tabs");
					const tabCount = kinds.filter((kind) => kind === "tab" || kind === "unlabelled-tab");
					expect(tabs && "tabs" in tabs ? tabs.tabs.length : -1).toBe(tabCount.length);
					const stray = kinds.some((kind) => kind.startsWith("stray") || kind === "nested-tab");
					expect(
						diagnostics.some((diagnostic) => diagnostic.code === "invalid-tabs-structure"),
					).toBe(stray);
				},
			),
		);
	});

	it("never serializes a position, line, className or style key", () => {
		const forbidden = new Set(["position", "line", "className", "style"]);
		const check = (value: unknown, key?: string) => {
			if (key !== undefined) expect(forbidden.has(key)).toBe(false);
			if (Array.isArray(value)) value.forEach((item) => check(item));
			else if (value !== null && typeof value === "object") {
				for (const [name, child] of Object.entries(value)) {
					// A component's props are the author's JSON values (a DataTable
					// row may well have a `line` column), not tree structure.
					if (name === "props") {
						for (const prop of Object.keys(child as object))
							expect(forbidden.has(prop)).toBe(false);
						continue;
					}
					check(child, name);
				}
			}
		};
		fc.assert(
			fc.property(anySource, (source) => {
				check(JSON.parse(JSON.stringify(parse(source).tree)));
			}),
		);
	});
});
