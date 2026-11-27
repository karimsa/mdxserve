import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { JSDOM } from "jsdom";
import { renderShell } from "../../src/http/shell.js";
import { shellTemplate } from "../helpers/http.js";

const textValue = fc.string({
	unit: fc.constantFrom("<", ">", '"', "'", "&", "\n", "x", "é", " "),
	maxLength: 60,
});

const route = { kind: "doc", path: "/docs/a.md", rootName: "docs", rootDir: "/docs" } as const;

/** How many elements the template's head and body hold before any metadata. */
function baseline(): { head: number; body: number } {
	const page = new JSDOM(renderShell(shellTemplate(), route));
	try {
		const { document } = page.window;
		return { head: document.head.children.length, body: document.body.children.length };
	} finally {
		page.window.close();
	}
}

describe("metadata HTML serialization", () => {
	it("round-trips text and ordered repeated properties without creating elements", () => {
		const empty = baseline();
		fc.assert(
			fc.property(
				textValue,
				textValue,
				fc.array(textValue, { maxLength: 8 }),
				(title, description, values) => {
					const html = renderShell(shellTemplate(), route, {
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
						// The title replaces none of the template's elements; the description
						// and each property add one, and the body gains nothing beyond the route.
						expect(document.head.children).toHaveLength(empty.head + 1 + values.length);
						expect(document.body.children).toHaveLength(empty.body);
					} finally {
						page.window.close();
					}
				},
			),
			{ numRuns: 50 },
		);
	});
});
