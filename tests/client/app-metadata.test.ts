// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../client/App";
import { docModuleCache } from "../../client/doc-module-cache";
import type { Route } from "../../client/router";

vi.mock("../../client/router", () => ({
	useRouter: (initialRoute: Route) => ({ route: initialRoute, navigate: () => {} }),
	titleFor: () => "document.md",
}));
vi.mock("../../client/shell/AppShell", () => ({ AppShell: () => null }));

const route: Extract<Route, { kind: "doc" }> = {
	kind: "doc",
	path: "/docs/document.md",
	rootName: "docs",
	rootDir: "/docs",
	metadata: {
		title: "Server title",
		description: "Server description",
		canonical: "https://example.com/document",
		openGraph: [
			{ property: "og:image", content: "https://example.com/first.png" },
			{ property: "og:image:alt", content: "First image" },
			{ property: "og:image", content: "https://example.com/second.png" },
		],
	},
};
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	document.head.innerHTML = "";
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	docModuleCache.clear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	docModuleCache.clear();
	vi.unstubAllGlobals();
});

describe("App metadata after module loading", () => {
	it("preserves all server metadata when the initial document module fails", async () => {
		await act(async () => root.render(createElement(App, { initialRoute: route })));
		docModuleCache.set(route.path, { status: "error", message: "Document failed to compile" });
		await act(async () => root.render(createElement(App, { initialRoute: { ...route } })));

		expect(document.title).toBe("Server title");
		expect(document.querySelector("meta[name=description]")?.getAttribute("content")).toBe(
			"Server description",
		);
		expect(document.querySelector("link[rel=canonical]")?.getAttribute("href")).toBe(
			"https://example.com/document",
		);
		expect(
			[...document.querySelectorAll("meta[property]")].map((element) => ({
				property: element.getAttribute("property"),
				content: element.getAttribute("content"),
			})),
		).toEqual(route.metadata!.openGraph);
	});

	it("uses a successfully loaded module even when it removes server metadata", async () => {
		await act(async () => root.render(createElement(App, { initialRoute: route })));
		docModuleCache.set(route.path, {
			status: "ok",
			Component: () => null,
			metadata: { openGraph: [] },
		});
		await act(async () => root.render(createElement(App, { initialRoute: { ...route } })));
		expect(document.title).toBe("document.md");
		expect(document.querySelectorAll("[data-mdxserve-metadata]")).toHaveLength(0);
	});

	it("clears previous metadata for a failed navigation without server metadata", async () => {
		await act(async () => root.render(createElement(App, { initialRoute: route })));
		const nextRoute = { ...route, path: "/docs/broken.md", metadata: undefined };
		docModuleCache.set(nextRoute.path, { status: "error", message: "Document failed to compile" });
		await act(async () => root.render(createElement(App, { initialRoute: nextRoute })));
		expect(document.title).toBe("document.md");
		expect(document.querySelectorAll("[data-mdxserve-metadata]")).toHaveLength(0);
	});
});
