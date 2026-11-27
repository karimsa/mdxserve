import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const rawUrlPrefix = "https://raw.githubusercontent.com/karimsa/mdxserve/main/";

const trackedFiles = new Set(
	execFileSync("git", ["ls-files", "-z"], { cwd: projectRoot, encoding: "utf8" })
		.split("\0")
		.filter(Boolean),
);

// Examples inside fenced code blocks are not part of the rendered page.
const readme = readFileSync(resolve(projectRoot, "README.md"), "utf8").replaceAll(
	/^```[^\n]*\n[\s\S]*?^```$/gm,
	"",
);

function rawUrlPaths(markdown: string): string[] {
	const pattern = /https:\/\/raw\.githubusercontent\.com\/karimsa\/mdxserve\/main\/[^\s"')>]+/g;
	return [...markdown.matchAll(pattern)].map((match) => match[0].slice(rawUrlPrefix.length));
}

function relativeImagePaths(markdown: string): string[] {
	const sources = [
		...[...markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)/g)].map((match) => match[1]),
		...[...markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]),
	];
	return sources
		.filter((source) => !/^[a-z][a-z0-9+.-]*:/i.test(source) && !source.startsWith("//"))
		.map((source) => source.replace(/^\.\//, "").split(/[?#]/)[0]);
}

it("finds the README's logo and screenshots", () => {
	expect(rawUrlPaths(readme).length).toBeGreaterThan(0);
	expect(relativeImagePaths(readme).length).toBeGreaterThan(0);
});

// npmjs.com cannot resolve a path inside the repository, so the README points at
// raw.githubusercontent.com on main. A file moved without updating the README breaks it
// on GitHub and npm alike.
it("points every raw.githubusercontent.com URL in the README at a tracked file", () => {
	const missing = rawUrlPaths(readme).filter((path) => !trackedFiles.has(path));
	expect(missing).toEqual([]);
});

it("points every relative image in the README at a tracked file", () => {
	const missing = relativeImagePaths(readme).filter((path) => !trackedFiles.has(path));
	expect(missing).toEqual([]);
});
