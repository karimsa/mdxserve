import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { StyleSheet } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import type { ProbeResult } from "../src/servers/connection";
import { SERVERS_KEY, type KnownServer } from "../src/servers/store";
import { APP_ROUTES } from "./app-routes";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

// The Contents sheet: a route over the tabs with the system's own bar, opened from a document's
// Contents item in the Library and in Search, through the real router.

const STUDIO = "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e";
const STUDIO_URL = "https://studio.tail1.ts.net";
const DOC = "/srv/example/guide.md";
const LIBRARY_URL = `/s/${STUDIO}/doc/srv/example/guide.md`;
const SEARCH_URL = `/search/s/${STUDIO}/doc/srv/example/guide.md`;

const SERVER_INFO: ServerInfo = {
	id: STUDIO,
	name: "Studio",
	version: "0.7.0",
	permissions: "full",
	mermaidVersion: "10.9.8",
	treeSchemaVersion: 1,
	tailnetUrls: [],
};

const KNOWN: KnownServer = {
	id: STUDIO,
	name: "Studio",
	version: "0.7.0",
	permissions: "full",
	treeSchemaVersion: 1,
	addedAt: "2026-11-27T12:00:00.000Z",
	addresses: [{ url: STUDIO_URL, source: "manual" }],
};

const text = (value: string) => ({ type: "text", value });
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });

/** A guide with a heading inside its second tab, which is not the one selected at first. */
function guide({ extra = false } = {}) {
	const linuxSetup = { id: "os>linux>linux-setup", label: "Linux setup", kind: "heading" };
	return {
		schemaVersion: 1,
		metadata: { openGraph: [] },
		toc: [
			{
				id: "setup",
				label: "Setup",
				kind: "heading",
				children: [
					{ id: "os>mac", label: "macOS", kind: "tab", children: [] },
					{
						id: "os>linux",
						label: "Linux",
						kind: "tab",
						children: [{ ...linuxSetup, children: [] }],
					},
				],
			},
			...(extra ? [{ id: "later", label: "Added later", kind: "heading", children: [] }] : []),
		],
		children: [
			{
				type: "section",
				id: "guide",
				level: 1,
				heading: [text("Guide")],
				children: [
					{
						type: "section",
						id: "setup",
						level: 2,
						heading: [text("Setup")],
						children: [
							paragraph(text("Install it.")),
							{
								type: "tabs",
								id: "os",
								defaultValue: "mac",
								tabs: [
									{
										id: "os>mac",
										value: "mac",
										label: "macOS",
										children: [paragraph(text("On a Mac"))],
									},
									{
										id: "os>linux",
										value: "linux",
										label: "Linux",
										children: [
											{
												type: "section",
												id: linuxSetup.id,
												level: 3,
												heading: [text("Linux setup")],
												children: [paragraph(text("On Linux"))],
											},
										],
									},
								],
							},
						],
					},
					...(extra
						? [
								{
									type: "section",
									id: "later",
									level: 2,
									heading: [text("Added later")],
									children: [paragraph(text("New."))],
								},
							]
						: []),
				],
			},
		],
	};
}

const mockDocuments = new Map<string, () => unknown>();
const mockProbeAnswers = new Map<string, ProbeResult>();

jest.mock("../src/servers/probe", () => ({
	createProbe: () => async (origin: string) =>
		mockProbeAnswers.get(origin) ?? { kind: "failed", cause: "could not connect" },
}));

jest.mock("@mdxserve/client/api", () => ({
	createApiClient: () => ({
		getDocument: {
			query: async ({ path }: { path: string }) => {
				const answer = mockDocuments.get(path);
				if (!answer)
					throw Object.assign(new Error(`Not found: ${path}`), { data: { code: "NOT_FOUND" } });
				return answer();
			},
		},
		listComments: { query: async () => ({ threads: [], version: "v1" }) },
	}),
}));

type MockDocListeners = Set<(path: string, cause: string) => void>;
const mockDocListeners: MockDocListeners = new Set();

jest.mock("@mdxserve/client/realtime", () => ({
	createRealtime: () => ({
		joinDocument: () => {},
		leaveDocument: () => {},
		onDocChanged: (listener: (path: string, cause: string) => void) => {
			mockDocListeners.add(listener);
			return () => mockDocListeners.delete(listener);
		},
		onListingChanged: () => () => {},
		onRootsChanged: () => () => {},
		close() {},
	}),
}));

/** A host element of the rendered tree, as `screen.toJSON()` returns them. */
interface HostElement {
	type: string;
	props: Record<string, any>;
	children: (HostElement | string)[] | null;
}

function allHosts(tree: unknown, type: string): HostElement[] {
	if (tree === null || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap((child) => allHosts(child, type));
	const element = tree as HostElement;
	return [...(element.type === type ? [element] : []), ...allHosts(element.children ?? [], type)];
}

function headerTitled(title: string): HostElement {
	const header = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
		(candidate) => candidate.props.title === title,
	);
	if (!header) throw new Error(`No header titled ${title}`);
	return header;
}

function headerItem(title: string, label: string): Record<string, any> {
	const items = (headerTitled(title).props.headerRightBarButtonItems ?? []) as Array<
		Record<string, any>
	>;
	const item = items.find((candidate) => candidate.accessibilityLabel === label);
	if (!item) throw new Error(`No ${label} item in the ${title} header`);
	return item;
}

/** A folded Duo: the vertical bar on the right, as the sheet's own safe area reports it. */
const FOLDED: EdgeInsets = { top: 0, right: 84, bottom: 21, left: 0 };

async function setInsets(insets: EdgeInsets) {
	await act(async () => {
		for (const provider of allHosts(screen.toJSON(), "RNCSafeAreaProvider"))
			provider.props.onInsetsChange({
				nativeEvent: { insets, frame: { x: 0, y: 0, width: 393, height: 852 } },
			});
	});
}

/** Opens the document at `url` and presses its Contents item. */
async function openContents(url: string) {
	await renderRouter(APP_ROUTES, { initialUrl: url });
	await screen.findByRole("heading", { name: "Guide" });
	await act(async () => headerItem("guide.md", "Contents").onPress());
	expect(screen).toHavePathname("/contents");
	await screen.findByTestId("contents-list");
}

beforeEach(async () => {
	await AsyncStorage.clear();
	await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify({ servers: [KNOWN] }));
	mockProbeAnswers.clear();
	mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: SERVER_INFO });
	mockDocuments.clear();
	mockDocListeners.clear();
});

afterEach(async () => {
	await act(() => Uniwind.setTheme("light"));
});

describe.each(["light", "dark"] as const)("a document's Contents sheet (%s)", (theme) => {
	beforeEach(async () => {
		await act(() => Uniwind.setTheme(theme));
		mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
	});

	it("opens as a route under the system bar: its title, a Done item and no wordmark", async () => {
		await openContents(LIBRARY_URL);
		const header = headerTitled("Contents");
		expect(header.props.translucent).toBe(false);
		expect(allHosts(header, "RNSScreenStackHeaderSubview")).toEqual([]);
		expect(screen.queryByTestId("header-background")).toBeNull();
		expect(headerItem("Contents", "Done")).toMatchObject({
			icon: { name: "checkmark" },
			variant: "done",
		});
	});

	it("lists every heading and tab as a button with its text and level", async () => {
		await openContents(LIBRARY_URL);
		for (const label of [
			"Setup, heading level 2",
			"macOS, tab",
			"Linux, tab",
			"Linux setup, heading level 3",
		])
			expect(screen.getByRole("button", { name: label })).toBeOnTheScreen();
	});

	it("keeps the rows and their dividers inside the sheet's safe area", async () => {
		await openContents(LIBRARY_URL);
		await setInsets(FOLDED);
		const list = screen.getByTestId("contents-list");
		expect(list.props.contentInsetAdjustmentBehavior).toBe("automatic");
		const style = StyleSheet.flatten(list.props.contentContainerStyle);
		expect({ left: style.paddingLeft, right: style.paddingRight }).toEqual({ left: 0, right: 84 });
	});

	it("closes and reveals a heading inside a tab that is not selected, selecting it", async () => {
		await openContents(LIBRARY_URL);
		await fireEvent.press(screen.getByRole("button", { name: "Linux setup, heading level 3" }));
		expect(screen).toHavePathname(LIBRARY_URL);
		expect(await screen.findByRole("tab", { name: "Linux", selected: true })).toBeOnTheScreen();
		expect(screen.queryByTestId("contents-list")).toBeNull();
	});

	it("closes with Done and leaves the document as it was", async () => {
		await openContents(LIBRARY_URL);
		await act(async () => headerItem("Contents", "Done").onPress());
		expect(screen).toHavePathname(LIBRARY_URL);
		await waitFor(() => expect(screen.queryByTestId("contents-list")).toBeNull());
		expect(screen.getByRole("tab", { name: "macOS", selected: true })).toBeOnTheScreen();
	});

	it("works from the Search tab and returns to the same document", async () => {
		await openContents(SEARCH_URL);
		await fireEvent.press(screen.getByRole("button", { name: "Linux, tab" }));
		expect(screen).toHavePathname(SEARCH_URL);
		expect(await screen.findByRole("tab", { name: "Linux", selected: true })).toBeOnTheScreen();
	});

	it("lists the document's new headings when a refetch lands while it is open", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let edited = false;
		mockDocuments.set(DOC, async () => {
			if (!edited) return { document: guide(), version: "v1" };
			await gate;
			return { document: guide({ extra: true }), version: "v2" };
		});
		await renderRouter(APP_ROUTES, { initialUrl: LIBRARY_URL });
		await screen.findByRole("heading", { name: "Guide" });
		// The file changes on disk and the refetch is still on its way when the sheet opens.
		edited = true;
		await act(async () => {
			for (const listener of [...mockDocListeners]) listener(DOC, "changed");
		});
		await act(async () => headerItem("guide.md", "Contents").onPress());
		await screen.findByTestId("contents-list");
		expect(screen.queryByRole("button", { name: "Added later, heading level 2" })).toBeNull();
		await act(async () => release());
		const added = await screen.findByRole("button", { name: "Added later, heading level 2" });
		await fireEvent.press(added);
		expect(screen).toHavePathname(LIBRARY_URL);
		expect(screen.getByRole("heading", { name: "Added later" })).toBeOnTheScreen();
	});
});
