// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ListingView } from "../../client/ListingView";
import { contentLayoutAtom } from "../../client/state";

vi.mock("../../client/api", () => ({
	trpc: { moveDocsToTrash: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("localStorage", new JSDOM("", { url: "http://localhost" }).window.localStorage);
	getDefaultStore().set(contentLayoutAtom, "full-width");
	HTMLDialogElement.prototype.showModal = function () {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function () {
		this.open = false;
	};
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});
it("shows delete confirmation for selected files in full-width mode", async () => {
	await act(async () =>
		root.render(
			createElement(
				QueryClientProvider,
				{ client: new QueryClient() },
				createElement(ListingView, {
					singleRoot: true,
					route: {
						path: "/docs/",
						rootDir: "/docs",
						entries: [{ name: "guide.md", isDir: false, isDoc: true, title: "Guide" }],
					},
				}),
			),
		),
	);
	expect(document.querySelector('[aria-label="Resize listing"]')).toBeNull();
	await act(async () =>
		document.querySelector<HTMLInputElement>('[aria-label="Select Guide"]')!.click(),
	);
	await act(async () =>
		[...document.querySelectorAll("button")]
			.find((button) => button.textContent?.trim() === "Delete…")!
			.click(),
	);
	const dialog = document.querySelector<HTMLDialogElement>('[role="alertdialog"]')!;
	expect(dialog.open).toBe(true);
	expect(dialog.textContent).toContain("guide.md");
	expect(dialog.textContent).toContain("Move to Trash");
});
