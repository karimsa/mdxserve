import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
	FLOW_DIRECTIONS,
	readFlowchartDirection,
	setFlowchartDirection,
	type FlowDirection,
} from "../../client/mermaid-direction.js";

const direction = fc.constantFrom<FlowDirection>(...FLOW_DIRECTIONS);

/** A line that never reads as a header or comment, so it can only be body. */
const bodyLine = fc
	.stringMatching(/^[A-Za-z0-9 _>|[\]()-]*$/)
	.filter((line) => !/^\s*(flowchart|graph)/.test(line) && !line.startsWith("%%"));

const body = fc.array(bodyLine, { maxLength: 6 }).map((lines) => lines.join("\n"));

const keyword = fc.constantFrom("flowchart", "graph", "flowchart-elk");
const spelledDirection = fc.option(fc.constantFrom("TB", "TD", "BT", "LR", "RL"), { nil: null });
const gap = fc.constantFrom(" ", "  ", "\t");
const suffix = fc.constantFrom("", ";", " ;", "  %% trailing");
const indent = fc.constantFrom("", "  ", "\t");

const header = fc
	.tuple(indent, keyword, gap, spelledDirection, suffix)
	.map(
		([lead, word, space, spelled, tail]) =>
			`${lead}${word}${spelled === null ? "" : space + spelled}${tail}`,
	);

const frontMatter = fc.option(
	fc
		.array(fc.stringMatching(/^[a-z]+: [A-Za-z ]+$/), { maxLength: 3 })
		.map((fields) => ["---", ...fields, "---"].join("\n")),
	{ nil: null },
);

const preamble = fc.array(
	fc.oneof(
		fc.constant(""),
		fc.stringMatching(/^%% [A-Za-z ]*$/),
		fc.constant('%%{init: {"theme": "base"}}%%'),
		fc.constant('%%{init: {\n  "theme": "base"\n}}%%'),
	),
	{ maxLength: 3 },
);

/** A flowchart the way an author might write one. */
const flowchart = fc
	.tuple(frontMatter, preamble, header, body)
	.map(([matter, lead, head, rest]) =>
		[...(matter === null ? [] : [matter]), ...lead, head, rest].join("\n"),
	);

describe("setFlowchartDirection", () => {
	it("is read back by readFlowchartDirection", () => {
		fc.assert(
			fc.property(flowchart, direction, (source, next) => {
				expect(readFlowchartDirection(setFlowchartDirection(source, next))).toBe(next);
			}),
		);
	});

	it("changes exactly one line, and only the direction on it", () => {
		fc.assert(
			fc.property(flowchart, direction, (source, next) => {
				const before = source.split("\n");
				const after = setFlowchartDirection(source, next).split("\n");
				expect(after.length).toBe(before.length);
				const changed = before.filter((line, index) => line !== after[index]);
				expect(changed.length).toBeLessThanOrEqual(1);
				for (const [index, line] of before.entries()) {
					if (line === after[index]) continue;
					// Strip the direction token from both spellings; what remains must agree.
					const strip = (text: string) => text.replace(/\s+(TB|TD|BT|LR|RL)(?=[\s;]|$)/, "");
					expect(strip(after[index]!)).toBe(strip(line));
				}
			}),
		);
	});

	it("is idempotent", () => {
		fc.assert(
			fc.property(flowchart, direction, (source, next) => {
				const once = setFlowchartDirection(source, next);
				expect(setFlowchartDirection(once, next)).toBe(once);
			}),
		);
	});

	it("is a no-op when the flowchart already lays out that way", () => {
		fc.assert(
			fc.property(flowchart, (source) => {
				const current = readFlowchartDirection(source);
				expect(current).not.toBeNull();
				expect(setFlowchartDirection(source, current!)).toBe(source);
			}),
		);
	});

	it("never touches a source that is not a flowchart", () => {
		fc.assert(
			fc.property(
				fc.string().filter((text) => readFlowchartDirection(text) === null),
				direction,
				(source, next) => {
					expect(setFlowchartDirection(source, next)).toBe(source);
				},
			),
		);
	});

	it("never throws and always preserves the line count", () => {
		fc.assert(
			fc.property(fc.string(), direction, (source, next) => {
				const result = setFlowchartDirection(source, next);
				expect(result.split("\n").length).toBe(source.split("\n").length);
			}),
		);
	});
});
