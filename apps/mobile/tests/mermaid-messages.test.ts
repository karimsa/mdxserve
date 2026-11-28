import { describe, expect, it } from "@jest/globals";
import * as fc from "fast-check";
import { diagramMessageSchema, parseDiagramMessage } from "../src/diagram/messages";

const RENDERED = {
	kind: "rendered",
	token: 3,
	width: 420.5,
	height: 180,
	title: "Login",
	description: null,
};

describe("parseDiagramMessage", () => {
	it("reads each kind", () => {
		expect(parseDiagramMessage(JSON.stringify({ kind: "ready" }))).toEqual({ kind: "ready" });
		expect(parseDiagramMessage(JSON.stringify(RENDERED))).toEqual(RENDERED);
		expect(
			parseDiagramMessage(JSON.stringify({ kind: "zoom", scale: 0.4, fitted: false })),
		).toEqual({ kind: "zoom", scale: 0.4, fitted: false });
		expect(
			parseDiagramMessage(JSON.stringify({ kind: "error", token: 1, message: "Parse error" })),
		).toEqual({ kind: "error", token: 1, message: "Parse error" });
	});

	it.each([
		["not JSON", "{kind"],
		["a wrong kind", JSON.stringify({ kind: "navigate", url: "https://example.com" })],
		["a missing token", JSON.stringify({ ...RENDERED, token: undefined })],
		["a negative token", JSON.stringify({ ...RENDERED, token: -1 })],
		["a zero width", JSON.stringify({ ...RENDERED, width: 0 })],
		["a huge height", JSON.stringify({ ...RENDERED, height: 1e9 })],
		["a long title", JSON.stringify({ ...RENDERED, title: "t".repeat(501) })],
		["a long description", JSON.stringify({ ...RENDERED, description: "d".repeat(2001) })],
		["a long message", JSON.stringify({ kind: "error", token: 1, message: "m".repeat(2001) })],
		["a zoom below a fifth", JSON.stringify({ kind: "zoom", scale: 0.1, fitted: false })],
		["a zoom past ten times", JSON.stringify({ kind: "zoom", scale: 11, fitted: false })],
		["a zoom without fitted", JSON.stringify({ kind: "zoom", scale: 2 })],
		["a JSON string", JSON.stringify("ready")],
		["null", "null"],
	])("gives null for %s", (_, data) => {
		expect(parseDiagramMessage(data)).toBeNull();
	});

	it.each([undefined, null, 42, { kind: "ready" }])("gives null for the non-string %p", (data) => {
		expect(parseDiagramMessage(data)).toBeNull();
	});

	it("never throws, and what it gives always satisfies the schema", () => {
		const message = fc.oneof(
			fc.string(),
			fc.json(),
			fc.anything().map((value) => {
				try {
					return JSON.stringify(value) ?? "";
				} catch {
					return "";
				}
			}),
			fc
				.record({
					kind: fc.constantFrom("ready", "rendered", "error"),
					token: fc.oneof(fc.integer(), fc.double()),
					width: fc.double(),
					height: fc.double(),
					title: fc.option(fc.string({ maxLength: 600 })),
					description: fc.option(fc.string({ maxLength: 2100 })),
					message: fc.string({ maxLength: 2100 }),
				})
				.map((value) => JSON.stringify(value)),
		);
		fc.assert(
			fc.property(message, (data) => {
				const parsed = parseDiagramMessage(data);
				if (parsed !== null) expect(diagramMessageSchema.safeParse(parsed).success).toBe(true);
			}),
		);
	});
});
