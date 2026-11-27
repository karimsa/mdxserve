// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { headingKey, resolveAnchor } from "../src/comments/anchor";
import { captureSelection, collectDoc, resolveInDom, resolveIndexOf } from "../src/comments/dom";

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

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number) {
	const range = document.createRange();
	range.setStart(startNode, startOffset);
	range.setEnd(endNode, endOffset);
	const selection = window.getSelection() as Selection;
	selection.removeAllRanges();
	selection.addRange(range);
	return selection;
}

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

describe("captureSelection", () => {
	it("captures across inline elements within a block", () => {
		const run = document.getElementById("run") as HTMLElement;
		const installer = run.querySelector("code")?.firstChild as Text;
		const restart = run.querySelector("strong")?.firstChild as Text;
		const anchor = captureSelection(select(installer, 2, restart, 4), article);
		expect(anchor).toEqual({
			heading: "Installation",
			block: "Run the installer, then restart your shell.",
			quote: "staller, then rest",
		});
	});

	it("clips a selection that ends in a later block", () => {
		const run = document.getElementById("run") as HTMLElement;
		const cell = document.getElementById("cell")?.firstChild as Text;
		const anchor = captureSelection(select(run.firstChild as Text, 4, cell, 4), article);
		expect(anchor?.quote).toBe("the installer, then restart your shell.");
		expect(anchor?.heading).toBe("Installation");
	});

	it("uses a null heading before the first heading", () => {
		const intro = document.getElementById("intro")?.firstChild as Text;
		expect(captureSelection(select(intro, 0, intro, 6), article)?.heading).toBeNull();
	});

	it("captures a heading block under itself", () => {
		const heading = document.getElementById("install")?.firstChild as Text;
		expect(captureSelection(select(heading, 0, heading, 4), article)).toEqual({
			heading: "Installation",
			block: "Installation",
			quote: "Inst",
		});
	});

	it("refuses collapsed, outside, editing and non-block selections", () => {
		const intro = document.getElementById("intro")?.firstChild as Text;
		expect(captureSelection(select(intro, 2, intro, 2), article)).toBeNull();
		const outside = document.createElement("p");
		outside.textContent = "outside";
		document.body.append(outside);
		expect(
			captureSelection(
				select(outside.firstChild as Text, 0, outside.firstChild as Text, 3),
				article,
			),
		).toBeNull();
		const editing = document.getElementById("editing")?.firstChild as Text;
		expect(captureSelection(select(editing, 0, editing, 3), article)).toBeNull();
		// A start between blocks is in no block.
		expect(captureSelection(select(article, 0, intro, 3), article)).toBeNull();
		// A parent list item is not innermost.
		const outer = document.getElementById("outer")?.firstChild as Text;
		expect(captureSelection(select(outer, 0, outer, 3), article)).toBeNull();
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

	it("round-trips a captured selection", () => {
		const run = document.getElementById("run") as HTMLElement;
		const installer = run.querySelector("code")?.firstChild as Text;
		const restart = run.querySelector("strong")?.firstChild as Text;
		const anchor = captureSelection(select(installer, 0, restart, 7), article);
		expect(anchor).not.toBeNull();
		if (!anchor) return;
		const doc = collectDoc(article);
		const result = resolveInDom(doc, resolveIndexOf(doc), anchor);
		expect(result.range?.toString()).toBe("installer, then restart");
		expect(resolveAnchor(anchor, resolveIndexOf(doc)).state).toBe("exact");
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
