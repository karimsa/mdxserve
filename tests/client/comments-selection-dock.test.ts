// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { dockOffset } from "../../client/comments/SelectionButton";

function addSheet(top: number): HTMLElement {
	const sheet = document.createElement("aside");
	sheet.setAttribute("data-comments-sheet", "");
	sheet.getBoundingClientRect = () => new DOMRect(0, top, 400, window.innerHeight - top);
	document.body.append(sheet);
	return sheet;
}

afterEach(() => {
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});

describe("dockOffset", () => {
	it("docks a fixed gap above the bottom of the screen", () => {
		expect(dockOffset()).toBe(16);
	});

	it("docks above the comments sheet while it covers the bottom of the screen", () => {
		vi.stubGlobal("innerHeight", 800);
		addSheet(300);
		expect(dockOffset()).toBe(516);
	});

	it("ignores a sheet that is still below the screen", () => {
		vi.stubGlobal("innerHeight", 800);
		addSheet(900);
		expect(dockOffset()).toBe(16);
	});
});
