// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { tocPresentation } from "../../client/shell/toc-mode";
import { readTocMode, TOC_MODES } from "../../client/state";

describe("tocPresentation", () => {
	it("puts the rail on the right in auto, with the button standing in below laptop width", () => {
		expect(tocPresentation("auto")).toEqual({
			rail: "hidden xl:block",
			button: "xl:hidden",
			above: false,
		});
	});

	it("gives the explicit right-hand rail a breakpoint more room than auto", () => {
		expect(tocPresentation("right")).toEqual({
			rail: "hidden lg:block",
			button: "lg:hidden",
			above: false,
		});
	});

	it("keeps a hidden list off the page behind a button at every width", () => {
		expect(tocPresentation("hidden")).toEqual({ rail: null, button: "", above: false });
	});

	it("shows only the inline list above content", () => {
		expect(tocPresentation("above")).toEqual({ rail: null, button: null, above: true });
	});

	it("shows nothing when disabled", () => {
		expect(tocPresentation("disabled")).toEqual({ rail: null, button: null, above: false });
	});

	it("leaves the list reachable in every mode but disabled", () => {
		for (const mode of TOC_MODES) {
			const { rail, button, above } = tocPresentation(mode);
			const reachable = above || button !== null;
			expect(reachable).toBe(mode !== "disabled");
			// A rail never appears without the button that covers the widths it is hidden at.
			if (rail !== null) expect(button).not.toBeNull();
		}
	});
});

describe("readTocMode", () => {
	function storage(): Storage {
		return new JSDOM("", { url: "http://localhost" }).window.localStorage;
	}

	it("defaults to auto", () => {
		expect(readTocMode(storage(), "auto")).toBe("auto");
	});

	it("keeps the table of contents off for someone who had hidden it before modes existed", () => {
		const saved = storage();
		saved.setItem("mdxserve.toc.visible", "false");
		expect(readTocMode(saved, "auto")).toBe("disabled");
	});

	it("treats the old visible setting as auto", () => {
		const saved = storage();
		saved.setItem("mdxserve.toc.visible", "true");
		expect(readTocMode(saved, "auto")).toBe("auto");
	});

	it("prefers a saved mode over the old setting, and ignores an unknown one", () => {
		const saved = storage();
		saved.setItem("mdxserve.toc.visible", "false");
		saved.setItem("mdxserve.toc.mode", '"above"');
		expect(readTocMode(saved, "auto")).toBe("above");
		saved.setItem("mdxserve.toc.mode", '"sideways"');
		expect(readTocMode(saved, "auto")).toBe("auto");
	});
});
