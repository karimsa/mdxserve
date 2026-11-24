// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { headingKey } from "../../client/comments/anchor";
import { collectDoc, resolveInDom, resolveIndexOf } from "../../client/comments/dom";

let article: HTMLElement;

beforeEach(() => {
	document.body.innerHTML = `
		<article class="mdx-prose">
			<p id="intro">Before any heading.</p>
			<h2 id="install">Installation<a class="mdx-anchor" href="#install">#</a></h2>
			<p id="run">Run the <code>installer</code>, then <strong>restart</strong> your shell.</p>
			<ul><li id="outer">Outer<ul><li id="inner">Inner item</li></ul></li></ul>
			<p id="chart">Chart <button>Copy</button><svg><text>svg text</text></svg> end</p>
			<div class="mdx-section" data-editing><p id="editing">Being edited</p></div>
			<h3 id="usage">Usage</h3>
			<table><tr><td id="cell">Cell one</td></tr></table>
		</article>`;
	article = document.querySelector("article") as HTMLElement;
});

afterEach(() => {
	document.body.innerHTML = "";
	window.getSelection()?.removeAllRanges();
});

describe("collectDoc hidden content", () => {
	it("skips content inside inert or aria-hidden containers", () => {
		article.insertAdjacentHTML(
			"beforeend",
			`<div inert><h2>Hidden heading</h2><p id="hidden">Hidden text</p></div>
			<div aria-hidden="true"><p id="hidden2">Also hidden</p></div>`,
		);
		const doc = collectDoc(article);
		const ids = doc.blocks.map((block) => block.el.id);
		expect(ids).not.toContain("hidden");
		expect(ids).not.toContain("hidden2");
		expect(doc.headings.map((heading) => heading.key)).not.toContain(headingKey("Hidden heading"));
	});
});

describe("collectDoc", () => {
	it("collects innermost blocks and headings in document order", () => {
		const doc = collectDoc(article);
		expect(doc.blocks.map((block) => block.el.id)).toEqual([
			"intro",
			"install",
			"run",
			"inner",
			"chart",
			"usage",
			"cell",
		]);
		expect(doc.headings).toEqual([
			{ key: "Installation", block: 1 },
			{ key: "Usage", block: 5 },
		]);
		expect(doc.blocks.map((block) => block.section)).toEqual([-1, 0, 0, 0, 0, 1, 1]);
	});

	it("leaves heading anchors, buttons, svg and editors out of the text", () => {
		const texts = Object.fromEntries(
			collectDoc(article).blocks.map((block) => [block.el.id, block.text]),
		);
		expect(texts.install).toBe("Installation");
		expect(texts.chart).toBe("Chart end");
		expect(texts.run).toBe("Run the installer, then restart your shell.");
	});
});

describe("resolveInDom", () => {
	it("builds a range over the quote, across inline elements", () => {
		const doc = collectDoc(article);
		const index = resolveIndexOf(doc);
		const result = resolveInDom(doc, index, {
			heading: "Installation",
			block: "Run the installer, then restart your shell.",
			quote: "then restart",
		});
		expect(result.resolution.state).toBe("exact");
		expect(result.range?.toString()).toBe("then restart");
		expect(result.scrollTarget?.id).toBe("run");
	});

	it("covers the whole block, the section heading, or nothing", () => {
		const doc = collectDoc(article);
		const index = resolveIndexOf(doc);
		const block = resolveInDom(doc, index, {
			heading: "Usage",
			block: "Cell one",
			quote: "gone",
		});
		expect(block.resolution.state).toBe("block");
		expect(block.range?.toString()).toBe("Cell one");
		const section = resolveInDom(doc, index, { heading: "Usage", block: "other", quote: "other" });
		expect(section.resolution.state).toBe("section");
		expect(section.range).toBeNull();
		expect(section.scrollTarget?.id).toBe("usage");
		const detached = resolveInDom(doc, index, { heading: "Nope", block: "x", quote: "x" });
		expect(detached.resolution.state).toBe("detached");
		expect(detached.scrollTarget).toBeNull();
	});
});
