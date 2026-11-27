import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
	flattenToc,
	fragmentOf,
	indexDocument,
	resolveFragment,
} from "../../client/document/document-index";
import { DocumentService } from "../../src/document/service";
import { fixtureRegistry } from "../fixtures/registry";

function parse(source: string) {
	return new DocumentService(fixtureRegistry, (relative) => relative).parse(source, "/doc.md").tree;
}

const SOURCE = "# Guide\n\n## Examples\n\nOne.\n\n## Again\n\n### Examples\n\nTwo.\n";

describe("resolveFragment", () => {
	it("takes an exact id first", () => {
		const tree = parse(SOURCE);
		expect(resolveFragment("again", indexDocument(tree), tree.toc)).toBe("again");
	});

	it("falls back to the first toc entry whose id ends with > and the fragment", () => {
		const tree = parse(SOURCE);
		const index = indexDocument(tree);
		expect(index.anchors.has("examples")).toBe(false);
		expect(resolveFragment("examples", index, tree.toc)).toBe("guide>examples");
	});

	it("resolves nothing for an empty or unknown fragment", () => {
		const tree = parse(SOURCE);
		const index = indexDocument(tree);
		expect(resolveFragment("", index, tree.toc)).toBeNull();
		expect(resolveFragment("missing", index, tree.toc)).toBeNull();
	});

	it("resolves the id of a failed section", () => {
		const tree = parse("## Fine\n\nText.\n\n## Broken\n\nA {stray\n");
		expect(resolveFragment("broken", indexDocument(tree), tree.toc)).toBe("broken");
	});

	it("resolves every toc entry's own id to itself", () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom("Alpha", "Beta", "Alpha"), { minLength: 1, maxLength: 6 }),
				(headings) => {
					const tree = parse(headings.map((heading) => `## ${heading}\n\nText.\n`).join("\n"));
					const index = indexDocument(tree);
					for (const { entry } of flattenToc(tree.toc)) {
						expect(resolveFragment(entry.id, index, tree.toc)).toBe(entry.id);
					}
				},
			),
		);
	});
});

describe("tab steps", () => {
	it("lists the tab to select for a heading inside a tab", () => {
		const tree = parse(
			'<Tabs id="os">\n<Tab label="Mac">\n\n### Install\n\nbrew\n\n</Tab>\n<Tab label="Linux">\n\napt\n\n</Tab>\n</Tabs>\n',
		);
		const index = indexDocument(tree);
		expect(index.tabSteps.get("os>linux")).toEqual([{ tabsId: "os", value: "linux" }]);
		const install = [...index.tabSteps.keys()].find((id) => id.endsWith("install"))!;
		expect(index.tabSteps.get(install)).toEqual([{ tabsId: "os", value: "mac" }]);
	});
});

describe("footnotes", () => {
	it("ignores references inside a footnote nothing references", () => {
		const tree = parse(
			"[^unused]: See [^nested].\n\nBody[^main].\n\n[^main]: Main.\n\n[^nested]: Nested.\n",
		);
		const index = indexDocument(tree);
		expect([...index.footnoteNumbers]).toEqual([["main", 1]]);
		expect(index.footnotes.map((definition) => definition.label)).toEqual(["main"]);
	});

	it("numbers a footnote referenced from another footnote after it", () => {
		const tree = parse("Body[^a].\n\n[^a]: See [^b].\n\n[^b]: B.\n");
		expect([...indexDocument(tree).footnoteNumbers]).toEqual([
			["a", 1],
			["b", 2],
		]);
	});
});

describe("fragmentOf", () => {
	it("decodes a hash and keeps a malformed escape literal", () => {
		expect(fragmentOf("#os%3Emac")).toBe("os>mac");
		expect(fragmentOf("#100%")).toBe("100%");
	});
});
