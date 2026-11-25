// @vitest-environment jsdom
import { act, createElement, useState, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocView } from "../../client/DocView";
import type { DocModuleState } from "../../client/doc-module-cache";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});

function Counter() {
	const [count, setCount] = useState(0);
	return createElement(
		"button",
		{ "data-testid": "counter", onClick: () => setCount(count + 1) },
		String(count),
	);
}

/** A fresh function per call, the way each re-import of a doc module yields one. */
function docModule(text: string): DocModuleState {
	const Component: ComponentType = () =>
		createElement("div", null, createElement("p", null, text), createElement(Counter));
	return { status: "ok", Component, metadata: { openGraph: [] } };
}

async function render(module: DocModuleState): Promise<void> {
	await act(async () => root.render(createElement(DocView, { path: "/docs/doc.md", module })));
}

describe("DocView across re-imports of a doc module", () => {
	it("keeps unchanged DOM and component state when the module is replaced", async () => {
		await render(docModule("before"));
		const paragraph = host.querySelector("p");
		const counter = host.querySelector<HTMLButtonElement>("[data-testid=counter]");
		await act(async () => counter?.click());
		expect(counter?.textContent).toBe("1");

		await render(docModule("after"));

		expect(host.querySelector("p")).toBe(paragraph);
		expect(paragraph?.textContent).toBe("after");
		expect(host.querySelector("[data-testid=counter]")).toBe(counter);
		expect(counter?.textContent).toBe("1");
	});

	it("clears a render error once a re-import no longer throws", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const broken: DocModuleState = {
			status: "ok",
			Component: () => {
				throw new Error("boom in render");
			},
			metadata: { openGraph: [] },
		};
		await render(broken);
		expect(host.textContent).toContain("boom in render");

		await render(docModule("fixed"));

		expect(host.textContent).not.toContain("boom in render");
		expect(host.querySelector("p")?.textContent).toBe("fixed");
		consoleError.mockRestore();
	});
});
