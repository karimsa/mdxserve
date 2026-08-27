import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rehypeInlineImages } from "../../src/rendering/mdx/inline-images.js";

// 1x1 transparent PNG.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);

let base: string;

beforeEach(async () => {
	base = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-inline-images-"));
	await fs.writeFile(path.join(base, "shot.png"), PNG);
});

afterEach(async () => {
	await fs.rm(base, { recursive: true, force: true });
});

function jsx(name: string, src: string) {
	return {
		type: "mdxJsxFlowElement",
		name,
		attributes: [{ type: "mdxJsxAttribute", name: "src", value: src }],
		children: [],
	};
}

function run(tree: unknown, warnings: string[] = []) {
	const transform = rehypeInlineImages({ base, onWarning: (message) => warnings.push(message) })();
	transform(tree);
	return tree;
}

const DATA_PNG = `data:image/png;base64,${PNG.toString("base64")}`;

describe("rehypeInlineImages", () => {
	it("inlines a hast <img>, a JSX <img>, and a <Screenshot> src alike", () => {
		const img = {
			type: "element",
			tagName: "img",
			properties: { src: "./shot.png" },
			children: [],
		};
		const jsxImg = jsx("img", "./shot.png");
		const screenshot = jsx("Screenshot", "./shot.png");
		run({ type: "root", children: [img, jsxImg, screenshot] });
		expect(img.properties.src).toBe(DATA_PNG);
		expect(jsxImg.attributes[0].value).toBe(DATA_PNG);
		expect(screenshot.attributes[0].value).toBe(DATA_PNG);
	});

	it("leaves a src on any other component alone", () => {
		const card = jsx("Card", "./shot.png");
		run({ type: "root", children: [card] });
		expect(card.attributes[0].value).toBe("./shot.png");
	});

	it("keeps an absolute or remote Screenshot src as is, and warns on a missing file", () => {
		const remote = jsx("Screenshot", "https://example.com/shot.png");
		const missing = jsx("Screenshot", "./nope.png");
		const warnings: string[] = [];
		run({ type: "root", children: [remote, missing] }, warnings);
		expect(remote.attributes[0].value).toBe("https://example.com/shot.png");
		expect(missing.attributes[0].value).toBe("./nope.png");
		expect(warnings).toEqual(["image not found: ./nope.png"]);
	});
});
