// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient, trpc } from "../../client/api";
import { DocumentView } from "../../client/document/DocumentView";
import { tabSelectionAtom } from "../../client/document/tabs-state";
import { useRouter, type Route } from "../../client/router";
import { DocumentService } from "../../src/document/service";
import { builtinRegistry } from "../helpers/components.js";

// No socket: every realtime call does nothing, and each listener returns its unsubscribe.
vi.mock("../../client/realtime", () => ({
	realtime: new Proxy({}, { get: () => () => () => {} }),
}));
vi.mock("../../client/Mermaid", () => ({ MermaidDiagram: () => null }));

const FROM = "/docs/from.md";
const TO = "/docs/to.md";
const TO_SOURCE = [
	"# To",
	"",
	"## Install",
	"",
	"Install text.",
	"",
	"## Platforms",
	"",
	'<Tabs id="os">',
	'<Tab label="Mac">',
	"",
	"Use brew.",
	"",
	"</Tab>",
	'<Tab label="Linux">',
	"",
	"Use apt.",
	"",
	"</Tab>",
	"</Tabs>",
	"",
].join("\n");

const service = new DocumentService(builtinRegistry, (relative) => relative);

function seed(path: string, source: string) {
	queryClient.setQueryData(trpc.getDocument.queryKey({ path }), {
		document: service.parse(source, path).tree,
		version: path,
	});
}

let currentRoute: Route | null = null;

/** The router and the open document, as AppShell wires them. */
function Harness() {
	const { route } = useRouter({ kind: "doc", path: FROM, rootName: "docs", rootDir: "/docs" });
	currentRoute = route;
	return route.kind === "doc"
		? createElement(DocumentView, { key: route.path, path: route.path })
		: null;
}

let root: Root;
let host: HTMLDivElement;
const scrolled: string[] = [];

async function settle() {
	for (let round = 0; round < 3; round++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}

async function clickLink(href: string) {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.textContent = "link";
	host.append(anchor);
	await act(async () => anchor.click());
	await settle();
}

beforeEach(async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("matchMedia", () => ({
		matches: true,
		addEventListener() {},
		removeEventListener() {},
	}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
		callback();
		return 0;
	});
	Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
		scrolled.push(this.id || this.getAttribute("data-tabs") || this.tagName);
	};
	scrolled.length = 0;
	queryClient.clear();
	getDefaultStore().set(tabSelectionAtom, {});
	history.replaceState(null, "", FROM);
	seed(FROM, "# From\n\nSee the other page.\n");
	seed(TO, TO_SOURCE);
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () =>
		root.render(
			createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)),
		),
	);
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	queryClient.clear();
	vi.unstubAllGlobals();
});

describe("a link to another document with a fragment", () => {
	it("opens the document at the heading the fragment names, and keeps the fragment in the URL", async () => {
		await clickLink("to.md#install");
		expect(currentRoute).toMatchObject({ kind: "doc", path: TO });
		expect(location.pathname + location.hash).toBe("/docs/to.md#install");
		expect(scrolled).toContain("install");
	});

	it("selects the tab a tab id names", async () => {
		await clickLink("to.md#os>linux");
		expect(currentRoute).toMatchObject({ kind: "doc", path: TO });
		expect(location.hash).toBe("#os%3Elinux");
		expect(host.querySelector<HTMLElement>('[id="os>linux"]')!.hidden).toBe(false);
		expect(host.querySelector<HTMLElement>('[id="os>mac"]')!.hidden).toBe(true);
		expect(scrolled.at(-1)).toBe("os");
	});

	it("goes back to the first document and forward to the fragment again", async () => {
		await clickLink("to.md#os>linux");
		await act(async () => {
			history.back();
		});
		await settle();
		expect(currentRoute).toMatchObject({ kind: "doc", path: FROM });
		expect(location.pathname + location.hash).toBe(FROM);

		getDefaultStore().set(tabSelectionAtom, {});
		scrolled.length = 0;
		await act(async () => {
			history.forward();
		});
		await settle();
		expect(currentRoute).toMatchObject({ kind: "doc", path: TO });
		expect(location.hash).toBe("#os%3Elinux");
		expect(host.querySelector<HTMLElement>('[id="os>linux"]')!.hidden).toBe(false);
	});
});
