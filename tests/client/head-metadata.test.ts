// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyHeadMetadata } from "../../client/head-metadata";

beforeEach(() => {
	document.head.innerHTML =
		"<title>Initial shell title</title><meta name='description' content='from shell' data-mdxserve-metadata>";
});

describe("committed route head ownership", () => {
	it("replaces shell tags and preserves repeated Open Graph order", () => {
		const metadata = {
			title: "Document title",
			description: "<unsafe> & quoted",
			canonical: "https://example.com/doc",
			openGraph: [
				{ property: "og:image", content: "first" },
				{ property: "og:image:alt", content: "first alt" },
				{ property: "og:image", content: "second" },
			],
		};
		applyHeadMetadata("Fallback", metadata);
		expect(document.querySelectorAll("title")).toHaveLength(1);
		expect(document.title).toBe("Document title");
		expect(document.querySelectorAll("meta[name=description]")).toHaveLength(1);
		expect(document.querySelector("meta[name=description]")?.getAttribute("content")).toBe(
			"<unsafe> & quoted",
		);
		expect(
			[...document.querySelectorAll("meta[property]")].map((element) =>
				element.getAttribute("content"),
			),
		).toEqual(["first", "first alt", "second"]);
		applyHeadMetadata("Fallback", metadata);
		expect(document.querySelectorAll("meta[property]")).toHaveLength(3);
	});

	it("clears old declarations for listing and error routes", () => {
		applyHeadMetadata("Doc", {
			description: "old",
			openGraph: [{ property: "og:title", content: "old" }],
		});
		applyHeadMetadata("Listing");
		expect(document.title).toBe("Listing");
		expect(document.querySelectorAll("[data-mdxserve-metadata]")).toHaveLength(0);
		applyHeadMetadata("Not found", { openGraph: [] });
		expect(document.title).toBe("Not found");
	});
});
