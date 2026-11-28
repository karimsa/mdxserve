import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { diagramMessageSchema } from "../src/diagram/messages";

interface PageRun {
	posted: unknown[];
	initialized: unknown[];
	svg: { width: string | null; hasStyle: boolean } | null;
	leftover: boolean;
	viewBoxes: string[];
}

/**
 * The real page.js in jsdom over a stub Mermaid that draws, throws, or is overtaken by a newer
 * request (setup/page-dom.js, run with node).
 */
function runPage(scenario: "draws" | "throws" | "overtaken" | "zooms"): PageRun {
	return JSON.parse(
		execFileSync(process.execPath, [path.join(__dirname, "setup/page-dom.js"), "run", scenario], {
			encoding: "utf8",
		}),
	) as PageRun;
}

describe("the page script", () => {
	it("posts ready once, renders a request and reports its size and text", () => {
		const run = runPage("draws");
		expect(run.initialized).toEqual([
			{
				startOnLoad: false,
				theme: "base",
				themeVariables: { primaryColor: "#e8f6f5" },
				securityLevel: "strict",
			},
		]);
		expect(run.svg).toEqual({ width: "100%", hasStyle: false });
		expect(run.posted).toEqual([
			{ kind: "ready" },
			{
				kind: "rendered",
				token: 1,
				width: 420,
				height: 180,
				title: "Login",
				description: "The app asks",
			},
		]);
	});

	it("posts Mermaid's error and removes the element Mermaid left behind", () => {
		const run = runPage("throws");
		expect(run.leftover).toBe(false);
		expect(run.posted).toEqual([
			{ kind: "ready" },
			{ kind: "error", token: 1, message: "Parse error on line 2" },
		]);
	});

	it("posts nothing for a request a newer one overtook", () => {
		const run = runPage("overtaken");
		expect(run.posted.map((message) => (message as { token?: number }).token)).toEqual([
			undefined,
			2,
		]);
	});

	it("zooms the drawing through its viewBox and reports the zoom", () => {
		const run = runPage("zooms");
		// The stub's drawing is 420 × 180 from 0 0: twice as close shows its middle half.
		expect(run.viewBoxes).toEqual(["105 45 210 90", "0 0 420 180"]);
		expect(run.posted.slice(2)).toEqual([
			{ kind: "zoom", scale: 2 },
			{ kind: "zoom", scale: 1 },
		]);
	});

	it("posts only messages the app's schema accepts", () => {
		for (const scenario of ["draws", "throws", "overtaken", "zooms"] as const)
			for (const message of runPage(scenario).posted)
				expect(diagramMessageSchema.safeParse(message).success).toBe(true);
	});
});
