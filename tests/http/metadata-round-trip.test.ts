import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { JSDOM } from "jsdom";
import { renderDocument } from "../../src/http/html.js";

const textValue = fc.string({
	unit: fc.constantFrom("<", ">", '"', "'", "&", "\n", "x", "é", " "),
	maxLength: 60,
});

describe("metadata HTML serialization", () => {
	it("round-trips text and ordered repeated properties without creating elements", () => {
		fc.assert(
			fc.property(
				textValue,
				textValue,
				fc.array(textValue, { maxLength: 8 }),
				(title, description, values) => {
					const html = renderDocument({
						title: "Fallback",
						body: "",
						metadata: {
							title,
							description,
							openGraph: values.map((content) => ({ property: "og:image:alt", content })),
						},
					});
					const page = new JSDOM(html);
					try {
						const { document } = page.window;
						expect(document.head.querySelectorAll("title")).toHaveLength(1);
						expect(document.head.querySelector("title")?.textContent).toBe(title);
						expect(
							document.head.querySelector('meta[name="description"]')?.getAttribute("content"),
						).toBe(description);
						expect(
							Array.from(
								document.head.querySelectorAll('meta[property="og:image:alt"]'),
								(element) => element.getAttribute("content"),
							),
						).toEqual(values);
						expect(document.head.querySelectorAll("script")).toHaveLength(1);
						expect(document.body.children).toHaveLength(0);
					} finally {
						page.window.close();
					}
				},
			),
			{ numRuns: 50 },
		);
	});
});
