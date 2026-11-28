import { describe, expect, it } from "@jest/globals";
import * as fc from "fast-check";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	buildDiagramPage,
	diagramPagePath,
	escapeScript,
	readDiagramPageInputs,
	unescapeScript,
} from "../scripts/diagram-page/build.js";

const inputs = readDiagramPageInputs();
const html = buildDiagramPage(inputs);

/** The built page as jsdom parses it (setup/page-dom.js, run with node). */
const page = JSON.parse(
	execFileSync(process.execPath, [path.join(__dirname, "setup/page-dom.js"), "inspect"], {
		maxBuffer: 64 * 1024 * 1024,
		encoding: "utf8",
	}),
) as {
	scripts: { hasSrc: boolean; text: string }[];
	withAddress: number;
	policy: string | null;
	style: string;
};
const policy = page.policy ?? "";

describe("the diagram page", () => {
	it("holds exactly two inline scripts", () => {
		expect(page.scripts).toHaveLength(2);
		for (const script of page.scripts) expect(script.hasSrc).toBe(false);
	});

	it("loads nothing by address (MS1)", () => {
		expect(page.withAddress).toBe(0);
	});

	it("allows each script by its hash and nothing else (MS1)", () => {
		const hashes = page.scripts.map(
			(script) => `'sha256-${createHash("sha256").update(script.text, "utf8").digest("base64")}'`,
		);
		const scriptSource = policy
			.split(";")
			.map((directive) => directive.trim())
			.find((directive) => directive.startsWith("script-src "));
		expect(scriptSource).toBe(`script-src ${hashes.join(" ")}`);
		expect(policy).toContain("default-src 'none'");
		expect(policy).not.toMatch(/https?:|\*|'unsafe-eval'/);
	});

	it("carries the installed mermaid.min.js byte for byte (MS7)", () => {
		const mermaid = page.scripts[0]?.text ?? "";
		const installed = readFileSync(require.resolve("mermaid/dist/mermaid.min.js"), "utf8");
		expect(unescapeScript(mermaid)).toBe(installed);
		expect(installed).toBe(inputs.mermaidSource);
	});

	it("is the file Metro bundles, up to date", () => {
		expect(readFileSync(diagramPagePath, "utf8")).toBe(html);
	});

	it("embeds Manrope's two faces", () => {
		const style = page.style;
		expect(style).toContain(`base64,${inputs.fonts.regular})`);
		expect(style).toContain(`base64,${inputs.fonts.bold})`);
		expect(policy).toContain("font-src data:");
	});
});

describe("escapeScript", () => {
	const piece = fc.constantFrom(
		"</script",
		"</SCRIPT",
		"</ScRiPt>",
		"<!--",
		"<",
		"/",
		"!",
		"-",
		"a",
	);
	const script = fc
		.array(fc.oneof(piece, fc.string()), { maxLength: 20 })
		.map((parts) => parts.join(""))
		.filter((text) => !/<\\\/script/i.test(text) && !text.includes("<\\!--"));

	it("leaves no text the HTML parser reacts to, and is undone exactly", () => {
		fc.assert(
			fc.property(script, (text) => {
				const escaped = escapeScript(text);
				expect(escaped).not.toMatch(/<\/script|<!--/i);
				expect(unescapeScript(escaped)).toBe(text);
			}),
		);
	});

	it("refuses text that already holds an escaped form", () => {
		expect(() => escapeScript("'<\\/script>'")).toThrow();
		expect(() => escapeScript("'<\\!--'")).toThrow();
	});
});
