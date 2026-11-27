// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient, trpc } from "../../client/api";
import { DocumentView } from "../../client/document/DocumentView";
import { revealNode } from "../../client/document/reveal";
import { useToc } from "../../client/shell/useToc";
import { tabSelectionAtom } from "../../client/document/tabs-state";
import { DocumentService } from "../../src/document/service";
import { builtinRegistry } from "../helpers/components.js";
import type { DocumentTree } from "../../src/document/schema";

const renders = vi.hoisted(() => ({ callout: 0 }));
vi.mock("../../client/builtins/Callout", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../client/builtins/Callout")>();
	const { createElement: create } = await import("react");
	return {
		default: (props: Parameters<typeof actual.default>[0]) => {
			renders.callout += 1;
			return create(actual.default, props);
		},
	};
});
vi.mock("../../client/Mermaid", () => ({ MermaidDiagram: () => null }));

const PATH = "/docs/guide.md";
const SOURCE = [
	"# Guide",
	"",
	'Intro with **bold**, _em_, ~~gone~~, `code`, a [link](https://example.com "Title"),',
	"an image ![alt text](https://example.com/a.png) and a note[^n].",
	"",
	"## Lists",
	"",
	"- one",
	"- [x] done",
	"",
	"3. three",
	"4. four",
	"",
	"> quoted",
	"",
	"---",
	"",
	'```ts title="a.ts" showLineNumbers {2}',
	"const a = 1;",
	"const b = 2;",
	"```",
	"",
	"| Name | Count |",
	"| --- | ---: |",
	"| x | 1 |",
	"",
	'<Callout title="Heads up">Careful.</Callout>',
	"",
	"Press <kbd>K</kbd>.",
	"",
	'<details id="more">',
	"  <summary>More</summary>",
	"",
	"Hidden body.",
	"",
	"</details>",
	"",
	"## Platforms",
	"",
	'<Tabs id="os">',
	'<Tab label="Mac">',
	"",
	"### Install",
	"",
	"Use brew.",
	"",
	"</Tab>",
	'<Tab label="Linux">',
	"",
	"Use apt.",
	"",
	"</Tab>",
	"</Tabs>",
	"",
	"## Examples",
	"",
	"First.",
	"",
	"## Again",
	"",
	"### Examples",
	"",
	"Second.",
	"",
	"[^n]: The note.",
	"",
].join("\n");

function parse(source: string): DocumentTree {
	return new DocumentService(builtinRegistry, (relative) => relative).parse(source, PATH).tree;
}

/** Let TanStack Query's batched notifications (a zero-delay timer) reach the observers. */
async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function seed(document: DocumentTree) {
	queryClient.setQueryData(trpc.getDocument.queryKey({ path: PATH }), {
		document,
		version: "version",
	});
}

let root: Root;
let host: HTMLDivElement;
const scrolled: string[] = [];

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("matchMedia", () => ({
		matches: true,
		addEventListener() {},
		removeEventListener() {},
	}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
		callback();
		return 0;
	});
	Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
		scrolled.push(this.id || this.getAttribute("data-tabs") || this.tagName);
	};
	scrolled.length = 0;
	renders.callout = 0;
	queryClient.clear();
	getDefaultStore().set(tabSelectionAtom, {});
	history.replaceState(null, "", "/");
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	queryClient.clear();
	vi.unstubAllGlobals();
});

async function mount() {
	await act(async () =>
		root.render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(DocumentView, { path: PATH }),
			),
		),
	);
}

describe("DocumentView renders each node type", () => {
	it("renders block and inline nodes the way the prose styles expect", async () => {
		seed(parse(SOURCE));
		await mount();
		const article = host.querySelector("article.mdx-prose")!;
		expect(article.querySelector("h1#guide")?.textContent).toBe("Guide");
		const lists = article.querySelector("h2#lists")!;
		expect(lists.querySelector("a.mdx-anchor")?.getAttribute("href")).toBe("#lists");
		expect(article.querySelector("strong")?.textContent).toBe("bold");
		expect(article.querySelector("em")?.textContent).toBe("em");
		expect(article.querySelector("del")?.textContent).toBe("gone");
		expect(article.querySelector("p > code")?.textContent).toBe("code");
		const link = article.querySelector('a[href="https://example.com"]')!;
		expect(link.getAttribute("title")).toBe("Title");
		expect(article.querySelector("img")?.getAttribute("alt")).toBe("alt text");
		expect(article.querySelector("ul li")?.textContent).toBe("one");
		expect(article.querySelector<HTMLInputElement>('li input[type="checkbox"]')?.checked).toBe(
			true,
		);
		expect(article.querySelector("ol")?.getAttribute("start")).toBe("3");
		expect(article.querySelector("blockquote")?.textContent).toContain("quoted");
		expect(article.querySelector("hr")).not.toBeNull();
		const code = article.querySelector('pre[data-language="ts"] code')!;
		expect(code.hasAttribute("data-line-numbers")).toBe(true);
		expect(code.querySelectorAll("[data-line]")).toHaveLength(2);
		expect(code.querySelectorAll("[data-highlighted-line]")).toHaveLength(1);
		expect(host.textContent).toContain("a.ts");
		expect(article.querySelector(".data-table table")?.textContent).toContain("Count");
		expect(article.textContent).toContain("Heads up");
		expect(article.querySelector("kbd")?.textContent).toBe("K");
		expect(article.querySelector("details#more > summary")?.innerHTML).toBe("More");
		expect(article.querySelector("[data-footnote-ref]")?.textContent).toBe("1");
		expect(article.querySelector("section[data-footnotes] li")?.textContent).toContain("The note.");
	});

	it("shows a failed section's message and source, and a placeholder for what it does not know", async () => {
		const tree = parse("## Fine\n\nText.\n\n## Broken\n\nA {stray brace\n");
		const children = [
			...tree.children,
			{ type: "hologram" } as unknown as DocumentTree["children"][number],
			{ type: "component", id: null, name: "FutureWidget", props: {}, children: [] },
			{ type: "element", id: null, tag: "marquee", attrs: {}, children: [] },
		] as DocumentTree["children"];
		seed({ ...tree, children });
		await mount();
		const failed = host.querySelector("#broken")!;
		expect(failed.getAttribute("role")).toBe("alert");
		expect(failed.textContent).toContain("A {stray brace");
		expect(host.textContent).toContain("Text.");
		const placeholders = [...host.querySelectorAll("[data-unknown-node]")].map(
			(element) => element.textContent,
		);
		expect(placeholders).toEqual([
			'Unsupported node type "hologram"',
			"Unsupported component <FutureWidget>",
			"Unsupported element <marquee>",
		]);
	});
});

describe("footnotes and literal children", () => {
	it("gives each reference to one footnote its own anchor and back link", async () => {
		seed(parse("One[^n] and two[^n].\n\n[^n]: The note.\n"));
		await mount();
		const references = [...host.querySelectorAll("[data-footnote-ref]")].map((link) => link.id);
		expect(references).toEqual(["user-content-fnref-n", "user-content-fnref-n-2"]);
		const backrefs = [...host.querySelectorAll("[data-footnote-backref]")].map((link) =>
			link.getAttribute("href"),
		);
		expect(backrefs).toEqual(["#user-content-fnref-n", "#user-content-fnref-n-2"]);
	});

	it("gives the footnotes heading its anchor link", async () => {
		seed(parse("One[^n].\n\n[^n]: The note.\n"));
		await mount();
		const heading = host.querySelector("h2#footnote-label")!;
		expect(heading.classList.contains("sr-only")).toBe(true);
		expect(heading.querySelector("a.mdx-anchor")?.getAttribute("href")).toBe("#footnote-label");
	});

	it("lists the footnotes heading last in the table of contents", async () => {
		seed(parse("## Body\n\nOne[^n].\n\n[^n]: The note.\n"));
		let labels: string[] = [];
		function Probe() {
			labels = useToc(PATH, 0).items.map((item) => `${item.id}:${item.label}`);
			return null;
		}
		await act(async () =>
			root.render(
				createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
			),
		);
		expect(labels).toEqual(["body:Body", "footnote-label:Footnotes"]);
	});

	it("renders an authored table as a plain table with its spans and alignment", async () => {
		seed(
			parse(
				'<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td colspan={2} align="center">spans two</td></tr><tr><td rowspan={2}>a</td><td>b</td></tr></tbody></table>\n',
			),
		);
		await mount();
		const table = host.querySelector("article table")!;
		expect(table.closest(".data-table")).toBeNull();
		const cells = [...table.querySelectorAll("td")];
		expect(cells[0].colSpan).toBe(2);
		expect(cells[0].getAttribute("align")).toBe("center");
		expect(cells[1].rowSpan).toBe(2);
	});

	it("renumbers references in unchanged sections when a reference moves", async () => {
		const before = "## A\n\nAlpha[^n].\n\n## B\n\nBeta[^n].\n\n## C\n\nGamma.\n\n[^n]: The note.\n";
		seed(parse(before));
		await mount();
		await act(async () =>
			seed(parse(before.replace("Alpha[^n].", "Alpha.").replace("Gamma.", "Gamma[^n]."))),
		);
		await settle();
		const references = [...host.querySelectorAll("[data-footnote-ref]")].map((link) => link.id);
		expect(references).toEqual(["user-content-fnref-n", "user-content-fnref-n-2"]);
	});

	it("keeps both paragraphs of a loose list item apart", async () => {
		seed(parse("- First paragraph.\n\n  Second paragraph.\n"));
		await mount();
		expect([...host.querySelectorAll("li > p")].map((paragraph) => paragraph.textContent)).toEqual([
			"First paragraph.",
			"Second paragraph.",
		]);
	});

	it("keeps a builtin's literal children prop when the element has no content", async () => {
		seed(parse('Status: <Badge children="Ready" />\n'));
		await mount();
		expect(host.textContent).toContain("Ready");
	});
});

describe("tabs", () => {
	it("keeps every panel mounted, hiding the unselected ones", async () => {
		seed(parse(SOURCE));
		await mount();
		const mac = host.querySelector<HTMLElement>('[id="os>mac"]')!;
		const linux = host.querySelector<HTMLElement>('[id="os>linux"]')!;
		expect(mac.hidden).toBe(false);
		expect(linux.hidden).toBe(true);
		expect(linux.textContent).toContain("Use apt.");
	});

	it("revealNode selects the tab on the way to a node and scrolls to it", async () => {
		seed(parse(SOURCE));
		await mount();
		await act(async () => {
			expect(revealNode("os>linux")).toBe(true);
		});
		expect(host.querySelector<HTMLElement>('[id="os>linux"]')!.hidden).toBe(false);
		expect(host.querySelector<HTMLElement>('[id="os>mac"]')!.hidden).toBe(true);
		expect(scrolled.at(-1)).toBe("os");

		await act(async () => {
			expect(revealNode("install")).toBe(true);
		});
		expect(host.querySelector<HTMLElement>('[id="os>mac"]')!.hidden).toBe(false);
		expect(scrolled.at(-1)).toBe("install");
		expect(revealNode("no-such-node")).toBe(false);
	});

	it("keeps the selected tab when the document changes elsewhere", async () => {
		seed(parse(SOURCE));
		await mount();
		await act(async () => {
			revealNode("os>linux");
		});
		await act(async () => seed(parse(SOURCE.replace("First.", "First, edited."))));
		await settle();
		expect(host.textContent).toContain("First, edited.");
		expect(host.querySelector<HTMLElement>('[id="os>linux"]')!.hidden).toBe(false);
	});
});

describe("switching documents", () => {
	it("keeps the new document revealable when the old view unmounts in the same commit", async () => {
		const other = "/docs/other.md";
		seed(parse(SOURCE));
		queryClient.setQueryData(trpc.getDocument.queryKey({ path: other }), {
			document: parse("## Elsewhere\n\nText.\n"),
			version: "other",
		});
		const view = (path: string) =>
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(DocumentView, { key: path, path }),
			);
		await act(async () => root.render(view(other)));
		await act(async () => root.render(view(PATH)));
		await act(async () => {
			expect(revealNode("os>linux")).toBe(true);
		});
		expect(host.querySelector<HTMLElement>('[id="os>linux"]')!.hidden).toBe(false);
	});
});

describe("anchors", () => {
	it("opens the tab an exact fragment points into", async () => {
		history.replaceState(null, "", "/#install");
		seed(parse(SOURCE));
		await act(async () => {
			revealNode("os>linux");
		});
		await mount();
		expect(scrolled).toContain("install");
		expect(host.querySelector<HTMLElement>('[id="os>mac"]')!.hidden).toBe(false);
	});

	it("scrolls to a rendered element the fragment names, such as a footnote", async () => {
		history.replaceState(null, "", "/#user-content-fn-n");
		seed(parse("One[^n].\n\n[^n]: The note.\n"));
		await mount();
		expect(scrolled).toContain("user-content-fn-n");
	});

	it("falls back to the first entry whose path ends with the fragment", async () => {
		history.replaceState(null, "", "/#examples");
		const tree = parse(SOURCE);
		// Both "Examples" headings exist, so neither has the bare slug as its id.
		expect(tree.toc.some((entry) => entry.id === "examples")).toBe(false);
		seed(tree);
		await mount();
		expect(scrolled[0]).toMatch(/>examples$/);
	});
});

describe("memoized rendering", () => {
	it("renders nothing again after a refetch of identical JSON", async () => {
		seed(parse(SOURCE));
		await mount();
		const before = renders.callout;
		expect(before).toBeGreaterThan(0);
		await act(async () => seed(JSON.parse(JSON.stringify(parse(SOURCE))) as DocumentTree));
		await settle();
		expect(renders.callout).toBe(before);
	});

	it("re-renders only the section that changed", async () => {
		seed(parse(SOURCE));
		await mount();
		const before = renders.callout;
		await act(async () => seed(parse(SOURCE.replace("Second.", "Second, changed."))));
		await settle();
		expect(host.textContent).toContain("Second, changed.");
		expect(renders.callout).toBe(before);
	});
});
