// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { MdSection, type MdSectionProps } from "../../client/MdSection";
import { ListingView } from "../../client/ListingView";
import { shellInfo } from "../../client/router";

const { getDocSource } = vi.hoisted(() => ({ getDocSource: vi.fn() }));
vi.mock("../../client/api", () => ({
	trpcClient: { getDocSource: { query: getDocSource } },
	trpc: {
		moveDocsToTrash: {
			mutationOptions: () => ({ mutationFn: async () => ({ deleted: [], failed: [] }) }),
		},
	},
	queryClient: { invalidateQueries: vi.fn() },
}));

afterEach(() => {
	shellInfo.permissions = "full";
	getDocSource.mockClear();
});

async function render(view: ReturnType<typeof createElement>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => root.render(view));
	return {
		host,
		async cleanup() {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}

it("keeps restricted document sections readable without loading the editor", async () => {
	shellInfo.permissions = "restricted";
	const mounted = await render(
		createElement(
			MdSection,
			{ index: "0", startLine: "1", endLine: "2" } as MdSectionProps,
			"Read me",
		),
	);
	try {
		expect(mounted.host.textContent).toContain("Read me");
		expect(mounted.host.querySelector('[aria-label="Edit section"]')).toBeNull();
		await act(async () => {
			mounted.host
				.querySelector(".mdx-section")!
				.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		});
		expect(getDocSource).not.toHaveBeenCalled();
	} finally {
		await mounted.cleanup();
	}
});

it("keeps restricted listing navigation and sort while removing selection and delete", async () => {
	shellInfo.permissions = "restricted";
	const mounted = await render(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(ListingView, {
				route: {
					path: "/docs/",
					rootDir: "/docs",
					entries: [{ name: "guide.md", isDir: false, isDoc: true }],
				},
				singleRoot: true,
			}),
		),
	);
	try {
		expect(mounted.host.querySelector('a[href="/docs/guide.md"]')).not.toBeNull();
		expect(mounted.host.textContent).toContain("Sort by");
		expect(mounted.host.querySelector('input[type="checkbox"]')).toBeNull();
		expect(mounted.host.textContent).not.toContain("Select");
		expect(mounted.host.textContent).not.toContain("Delete");
	} finally {
		await mounted.cleanup();
	}
});

it("retains editor and selection controls in local mode", async () => {
	const section = await render(
		createElement(
			MdSection,
			{ index: "0", startLine: "1", endLine: "2" } as MdSectionProps,
			"Edit me",
		),
	);
	try {
		expect(section.host.querySelector('[aria-label="Edit section"]')).not.toBeNull();
	} finally {
		await section.cleanup();
	}

	const listing = await render(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient() },
			createElement(ListingView, {
				route: {
					path: "/docs/",
					rootDir: "/docs",
					entries: [{ name: "guide.md", isDir: false, isDoc: true }],
				},
				singleRoot: true,
			}),
		),
	);
	try {
		expect(listing.host.querySelector('input[aria-label="Select guide.md"]')).not.toBeNull();
		expect(listing.host.textContent).toContain("Select");
	} finally {
		await listing.cleanup();
	}
});
