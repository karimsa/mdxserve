// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StandaloneShell } from "../../client/shell/StandaloneShell";
import { docModuleCache } from "../../client/doc-module-cache";
import { contentLayoutAtom, tocVisibleAtom } from "../../client/state";

vi.mock("../../client/api", () => {
	throw new Error("Standalone settings must not import the server API");
});
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("localStorage", new JSDOM("", { url: "http://localhost" }).window.localStorage);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
	getDefaultStore().set(contentLayoutAtom, "flexible");
	getDefaultStore().set(tocVisibleAtom, true);
	docModuleCache.set("guide.md", {
		status: "ok",
		Component: () => createElement("h2", { id: "overview" }, "Overview"),
	});
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	docModuleCache.delete("guide.md");
	vi.unstubAllGlobals();
});
async function select(selector: string, value: string) {
	await act(async () => {
		const element = document.querySelector<HTMLSelectElement>(selector)!;
		element.value = value;
		element.dispatchEvent(new Event("change", { bubbles: true }));
	});
}
it("opens local settings from the standalone toolbar and applies autosaved layout controls", async () => {
	await act(async () =>
		root.render(createElement(StandaloneShell, { meta: { path: "guide.md", label: "Guide" } })),
	);
	expect(document.querySelectorAll('[aria-label="Resize page"]')).toHaveLength(2);
	expect(document.querySelector('[aria-label="Resize table of contents"]')).not.toBeNull();
	await act(async () =>
		document.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click(),
	);
	expect(document.querySelector("dialog")!.open).toBe(true);
	expect(document.querySelector("#diagram-agent")).toBeNull();
	expect(document.querySelector("dialog")!.textContent).not.toContain("Save settings");
	await select("#content-layout", "full-width");
	await select("#toc-visibility", "hidden");
	expect(document.querySelector('[aria-label="Resize page"]')).toBeNull();
	expect(document.querySelector('[aria-label="Resize table of contents"]')).toBeNull();
	expect(localStorage.getItem("mdxserve.content.layout")).toBe('"full-width"');
	expect(localStorage.getItem("mdxserve.toc.visible")).toBe("false");
	await select("#content-layout", "flexible");
	await select("#toc-visibility", "visible");
	expect(document.querySelectorAll('[aria-label="Resize page"]')).toHaveLength(2);
	expect(document.querySelector('[aria-label="Resize table of contents"]')).not.toBeNull();
});
