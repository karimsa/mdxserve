import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import * as client from "../src/comments/anchor";
import { normalizeText as serverNormalize } from "@karimsa/mdxserve/src/comments/anchor";
import {
	MAX_ANCHOR_HEADING,
	MAX_ANCHOR_TEXT,
	MAX_MESSAGE_BODY,
} from "@karimsa/mdxserve/src/comments/schema";

describe("client and server comment limits agree", () => {
	it("repeats the schema limits", () => {
		expect(client.MAX_ANCHOR_TEXT).toBe(MAX_ANCHOR_TEXT);
		expect(client.MAX_ANCHOR_HEADING).toBe(MAX_ANCHOR_HEADING);
		expect(client.MAX_MESSAGE_BODY).toBe(MAX_MESSAGE_BODY);
	});

	it("normalizes text identically", () => {
		const cases = ["", "  a  b ", "a\n\tb", " x y﻿", "é  \r\n z", "plain"];
		for (const text of cases) expect(client.normalizeText(text)).toBe(serverNormalize(text));
		fc.assert(
			fc.property(fc.string({ unit: "binary" }), (text) => {
				expect(client.normalizeText(text)).toBe(serverNormalize(text));
				expect(client.normalizeWithMap([text]).text).toBe(serverNormalize(text));
			}),
		);
	});
});

import { headingKey as clientHeadingKey } from "../src/comments/anchor";
import { headingKey as serverHeadingKey } from "@karimsa/mdxserve/src/comments/anchor";

describe("headingKey", () => {
	it("is the same on the client and the server", () => {
		for (const text of [
			"Usage",
			"  spaced   out  ",
			"word ".repeat(80),
			"x".repeat(299) + " tail",
		]) {
			expect(clientHeadingKey(text)).toBe(serverHeadingKey(text));
		}
	});
});
