import { describe, expect, it } from "vitest";
import { bodyLines } from "../../src/docs/frontmatter.js";

describe("frontmatter body extraction", () => {
	it.each([
		["---\n---\nBody", ["Body"]],
		["\uFEFF--- \r\n# Metadata\r\n---\r\n# Body", ["# Body"]],
		["---\ntitle: only metadata\n---", []],
	])("skips only a complete leading YAML block: %j", (source, expected) => {
		expect(bodyLines(source)).toEqual(expected);
	});

	it.each([
		"---\nnot: closed\n\n# Body",
		"# Body\n\n---\n\nVisible",
		"```yaml\n---\n# Example\n---\n```",
		"\n---\n# Not leading metadata\n---",
	])("preserves body rules, examples, and unclosed blocks: %j", (source) => {
		expect(bodyLines(source)).toEqual(source.split("\n"));
	});
});
