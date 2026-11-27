// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient, trpc } from "../src/api";
import type { Route } from "../src/router";

vi.mock("../src/router", () => ({
	useRouter: (initialRoute: Route) => ({ route: initialRoute, navigate: () => {} }),
	titleFor: () => "document.md",
}));
vi.mock("../src/shell/AppShell", () => ({ AppShell: () => null }));

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
	queryClient.clear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	queryClient.clear();
	vi.unstubAllGlobals();
});

function app(initialRoute: Route) {
	return createElement(
		QueryClientProvider,
		{ client: queryClient },
		createElement(App, { initialRoute }),
	);
}

function seedDocument(path: string, metadata: { title?: string; openGraph: [] }) {
	queryClient.setQueryData(trpc.getDocument.queryKey({ path }), {
		document: { schemaVersion: 1, metadata, toc: [], children: [] },
		version: "version",
	});
}

describe("App metadata from the document tree", () => {
	it("preserves all server metadata while the document has not loaded", async () => {
		await act(async () => root.render(app(route)));

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

	it("uses the loaded document's metadata even when it removes server metadata", async () => {
		seedDocument(route.path, { openGraph: [] });
		await act(async () => root.render(app(route)));
		expect(document.title).toBe("document.md");
		expect(document.querySelectorAll("[data-mdxserve-metadata]")).toHaveLength(0);
	});

	it("clears previous metadata for a navigation without server metadata", async () => {
		await act(async () => root.render(app(route)));
		const nextRoute = { ...route, path: "/docs/broken.md", metadata: undefined };
		await act(async () => root.render(app(nextRoute)));
		expect(document.title).toBe("document.md");
		expect(document.querySelectorAll("[data-mdxserve-metadata]")).toHaveLength(0);
	});
});
