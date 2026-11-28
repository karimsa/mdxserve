import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import { StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import type { CommentThread } from "@mdxserve/client/comments/threads";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import type { ProbeResult } from "../src/servers/connection";
import { PANEL_WIDTH, panelPlacement } from "../src/comments/placement";
import { SERVERS_KEY, type KnownServer } from "../src/servers/store";
import { APP_ROUTES } from "./app-routes";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

const stylesheet = loadCompiledStylesheet();

/** Whether the device draws Liquid Glass (iOS 26 and later); jest has no native module to ask. */
let mockGlass = false;
jest.mock("expo-glass-effect", () => ({
	...jest.requireActual<object>("expo-glass-effect"),
	isLiquidGlassAvailable: () => mockGlass,
}));

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

// The window's size, which the comments panel's placement follows.
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => {
	const { useSyncExternalStore } = jest.requireActual<typeof import("react")>("react");
	const listeners = new Set<() => void>();
	const window = { current: { width: 466, height: 852, scale: 3, fontScale: 1 } };
	return {
		__esModule: true,
		resize(next: typeof window.current) {
			window.current = next;
			listeners.forEach((notify) => notify());
		},
		default: () =>
			useSyncExternalStore(
				(notify: () => void) => {
					listeners.add(notify);
					return () => listeners.delete(notify);
				},
				() => window.current,
			),
	};
});
const { resize } = jest.requireMock<{
	resize(next: { width: number; height: number; scale: number; fontScale: number }): void;
}>("react-native/Libraries/Utilities/useWindowDimensions");

const STUDIO = "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e";
const STUDIO_URL = "https://studio.tail1.ts.net";
const DOC = "/srv/example/guide.md";
const DOC_URL = `/s/${STUDIO}/doc/srv/example/guide.md`;

const info: ServerInfo = {
	id: STUDIO,
	name: "Studio",
	version: "0.7.0",
	permissions: "full",
	mermaidVersion: "10.9.8",
	treeSchemaVersion: 1,
	tailnetUrls: [],
};

const known: KnownServer = {
	id: STUDIO,
	name: "Studio",
	version: "0.7.0",
	permissions: "full",
	treeSchemaVersion: 1,
	addedAt: "2026-11-27T12:00:00.000Z",
	addresses: [{ url: STUDIO_URL, source: "manual" }],
};

const text = (value: string) => ({ type: "text", value });

const mockGuide = {
	schemaVersion: 1,
	metadata: { openGraph: [] },
	toc: [],
	children: [
		{
			type: "section",
			id: "guide",
			level: 1,
			heading: [text("Guide")],
			children: [{ type: "paragraph", children: [text("Alpha beta gamma delta")] }],
		},
	],
};

const mockThread = {
	id: "beta",
	resolved: false,
	anchor: { heading: "Guide", block: "Alpha beta gamma delta", quote: "beta gamma" },
	messages: [
		{ id: "beta-1", author: "human", body: "Why this?", createdAt: "2026-11-27T12:00:00.000Z" },
	],
} as CommentThread;

let mockThreads: CommentThread[] = [mockThread];
const mockProbeAnswers = new Map<string, ProbeResult>();
const mockGetDocComments = jest.fn(async (_: { path: string }) => ({
	threads: mockThreads,
	diagnostics: [],
}));
const mockDocListeners = new Set<(path: string, cause: string) => void>();

jest.mock("../src/servers/probe", () => ({
	createProbe: () => async (origin: string) =>
		mockProbeAnswers.get(origin) ?? { kind: "failed", cause: "could not connect" },
}));

jest.mock("@mdxserve/client/api", () => ({
	createApiClient: () => ({
		getDocument: { query: async () => ({ document: mockGuide, version: "v1" }) },
		getDocComments: { query: mockGetDocComments },
	}),
}));

/** The live update room calls, in order. */
const mockRoom: string[] = [];

jest.mock("@mdxserve/client/realtime", () => ({
	createRealtime: () => ({
		joinDocument: (path: string) => mockRoom.push(`join ${path}`),
		leaveDocument: (path: string) => mockRoom.push(`leave ${path}`),
		onDocChanged: (listener: (path: string, cause: string) => void) => {
			mockDocListeners.add(listener);
			return () => mockDocListeners.delete(listener);
		},
		onListingChanged: () => () => {},
		onRootsChanged: () => () => {},
		close() {},
	}),
}));

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

/** What the native safe area views report when the window's insets change. */
async function setInsets(insets: { top: number; right: number; bottom: number; left: number }) {
	await act(async () => {
		for (const provider of allHosts(screen.toJSON(), "RNCSafeAreaProvider")) {
			provider.props.onInsetsChange({
				nativeEvent: { insets, frame: { x: 0, y: 0, width: 466, height: 852 } },
			});
		}
	});
}

function styleOf(testID: string) {
	return (
		StyleSheet.flatten(screen.getByTestId(testID, { includeHiddenElements: true }).props.style) ??
		{}
	);
}

/** The native header the document's screen draws. */
function documentHeader() {
	return allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
		(candidate) => candidate.props.title === "guide.md",
	);
}

/** The header of the Comments sheet, as the native stack receives it. */
function sheetHeader() {
	return allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
		(candidate) => candidate.props.title === "Comments",
	);
}

function commentsItem() {
	const items = (documentHeader()?.props.headerRightBarButtonItems ?? []) as Array<
		Record<string, any>
	>;
	return items.find((item) => String(item.accessibilityLabel).startsWith("Comments"));
}

async function openDocument(width: number) {
	resize({ width, height: 852, scale: 3, fontScale: 1 });
	await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
	await screen.findByRole("heading", { name: "Guide" });
}

async function pressComments() {
	await waitFor(() => expect(commentsItem()).toBeDefined());
	await act(async () => commentsItem()!.onPress());
}

beforeEach(async () => {
	await AsyncStorage.clear();
	await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify({ servers: [known] }));
	mockProbeAnswers.clear();
	mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info });
	mockThreads = [mockThread];
	mockDocListeners.clear();
	mockGetDocComments.mockClear();
});

/** The sheet's screen, as the native stack receives its presentation. */
function sheetScreen() {
	return allHosts(screen.toJSON(), "RNSModalScreen").find(
		(candidate) => candidate.props.stackPresentation === "formSheet",
	);
}

function hiddenQuote() {
	return within(screen.getByTestId("document-pane", { includeHiddenElements: true })).getByText(
		"beta gamma",
		{ includeHiddenElements: true },
	);
}

function reply(body: string): CommentThread {
	return {
		...mockThread,
		messages: [
			...mockThread.messages,
			{ id: "beta-2", author: "agent", body, createdAt: "2026-11-27T12:05:00.000Z" },
		],
	} as CommentThread;
}

describe("where the comments go", () => {
	it("is a sheet below 600 pt and a column beside the document from 600 pt (KA15)", () => {
		expect(panelPlacement(599)).toBe("sheet");
		expect(panelPlacement(600)).toBe("beside");
	});

	it("opens a form sheet over the document in a narrow window, not a column (KA15)", async () => {
		await openDocument(466);
		await setInsets({ top: 0, right: 84, bottom: 21, left: 0 });
		expect(sheetScreen()).toBeUndefined();
		await pressComments();
		expect(await screen.findByTestId("comments-sheet")).toBeOnTheScreen();
		expect(await screen.findByTestId("thread-beta")).toBeOnTheScreen();
		expect(screen.queryByTestId("comments-dock")).toBeNull();
		expect(screen.queryByTestId("comments-panel")).toBeNull();
		expect(styleOf("document-pane").flex).toBe(1);
		const presented = sheetScreen()!.props;
		expect(presented.stackPresentation).toBe("formSheet");
		expect(presented.sheetAllowedDetents).toEqual([0.3, 0.5, 1]);
		expect(presented.sheetLargestUndimmedDetentIndex).toBe(1);
		expect(presented.sheetGrabberVisible).toBe(true);
		// A document with threads opens at half height.
		expect(presented.sheetInitialDetentIndex).toBe(1);
	});

	it("opens short for a document with no threads, and says so in one line", async () => {
		mockThreads = [];
		await openDocument(466);
		await pressComments();
		expect(await screen.findByText("No open comments on this document.")).toBeOnTheScreen();
		expect(sheetScreen()!.props.sheetInitialDetentIndex).toBe(0);
		expect(sheetScreen()!.props.sheetAllowedDetents).toEqual([0.3, 0.5, 1]);
	});

	it("draws no bar: the control sits centred under the grabber, and no Close item", async () => {
		await openDocument(466);
		await pressComments();
		await screen.findByTestId("comments-sheet");
		expect(sheetScreen()).toBeDefined();
		// No navigation bar draws in the sheet: no title band, no bar items.
		expect(sheetHeader()?.props.hidden ?? true).toBe(true);
		expect(screen.queryByText("Comments")).toBeNull();
		expect(screen.queryByLabelText("Close comments")).toBeNull();
		const control = within(screen.getByTestId("comments-sheet")).getByTestId("comments-status");
		expect(control.props.values).toEqual(["Open · 1", "Resolved · 0"]);
		expect(StyleSheet.flatten(control.parent!.props.style).alignItems).toBe("center");
		expect(screen.getByTestId("comments-sheet").props.accessibilityLabel).toBe("Comments");
	});

	it("closes from the document's Comments item or VoiceOver's escape, and opens again", async () => {
		await openDocument(466);
		await pressComments();
		await screen.findByTestId("comments-sheet");
		await pressComments();
		await waitFor(() => expect(screen.queryByTestId("comments-sheet")).toBeNull());
		expect(sheetScreen()).toBeUndefined();
		await pressComments();
		expect(await screen.findByTestId("thread-beta")).toBeOnTheScreen();
		await act(async () => screen.getByTestId("comments-sheet").props.onAccessibilityEscape());
		await waitFor(() => expect(screen.queryByTestId("comments-sheet")).toBeNull());
		await pressComments();
		expect(await screen.findByTestId("comments-sheet")).toBeOnTheScreen();
	});

	it("selects a thread in the sheet when its highlight in the document is pressed", async () => {
		await openDocument(466);
		await pressComments();
		const row = await screen.findByRole("button", { name: "Show in the document: beta gamma" });
		expect(row.props.accessibilityState?.selected).toBeFalsy();
		await fireEvent.press(hiddenQuote());
		expect(
			await screen.findByRole("button", {
				name: "Show in the document: beta gamma",
				selected: true,
			}),
		).toBeOnTheScreen();
		// The selected thread shows the controls an inactive one hides.
		expect(screen.getByLabelText("Resolve thread")).toBeOnTheScreen();
	});

	it("keeps the document in its live update room while the sheet is open", async () => {
		await openDocument(466);
		await pressComments();
		await screen.findByTestId("thread-beta");
		expect(screen.queryByText("1 reply")).toBeNull();
		// The document's screen is behind the sheet, but it stays in its room and keeps listening.
		expect(mockRoom.at(-1)).toBe(`join ${DOC}`);
		expect(mockDocListeners.size).toBeGreaterThan(0);
		const reads = mockGetDocComments.mock.calls.length;
		mockThreads = [reply("Fixed it")];
		await act(async () => {
			for (const listener of mockDocListeners) listener(DOC, "changed");
		});
		expect(await screen.findByText("1 reply")).toBeOnTheScreen();
		expect(mockGetDocComments.mock.calls.length).toBeGreaterThan(reads);
	});

	it("goes beside the document in a wide window, with the control, and the Comments item closes it (KA15)", async () => {
		await openDocument(951);
		await setInsets({ top: 59, right: 0, bottom: 34, left: 0 });
		await pressComments();
		await screen.findByTestId("comments-panel");
		expect(styleOf("comments-dock").width).toBe(PANEL_WIDTH);
		expect(styleOf("comments-dock").height).toBeUndefined();
		const parent = screen.getByTestId("document-pane").parent!;
		expect(StyleSheet.flatten(parent.props.style).flexDirection).toBe("row");
		expect(screen.getByTestId("comments-status").props.values).toEqual([
			"Open · 1",
			"Resolved · 0",
		]);
		expect(screen.queryByLabelText("Close comments")).toBeNull();
		expect(screen.queryByTestId("comments-sheet")).toBeNull();
		expect(sheetScreen()).toBeUndefined();
		// The document's Comments item closes the column, as it opened it.
		await pressComments();
		await waitFor(() => expect(screen.queryByTestId("comments-dock")).toBeNull());
	});
});

describe.each(["light", "dark"] as const)("the sheet's surface (%s)", (theme) => {
	const { variables } = resolveTheme(stylesheet, theme);

	beforeEach(async () => {
		await act(() => Uniwind.setTheme(theme));
		mockGlass = false;
	});

	it("is the page colour where iOS has no Liquid Glass", async () => {
		await openDocument(466);
		await pressComments();
		await screen.findByTestId("comments-sheet");
		expect(styleOf("comments-sheet").backgroundColor).toBe(variables["--surface-page"]);
		await act(async () => screen.getByTestId("comments-sheet").props.onAccessibilityEscape());
		await act(() => Uniwind.setTheme("light"));
	});

	it("paints nothing over the system's glass, and tints the active thread", async () => {
		mockGlass = true;
		await openDocument(466);
		await pressComments();
		await screen.findByTestId("comments-sheet");
		expect(styleOf("comments-sheet").backgroundColor).toBeUndefined();
		expect(StyleSheet.flatten(sheetScreen()!.props.style)?.backgroundColor).toBe("transparent");
		await fireEvent.press(
			await screen.findByRole("button", { name: "Show in the document: beta gamma" }),
		);
		const active = await screen.findByTestId("thread-beta");
		const tint = StyleSheet.flatten(active.props.style)?.backgroundColor;
		expect(tint).toBeDefined();
		expect(tint).not.toBe(variables["--surface-card"]);
		await act(async () => screen.getByTestId("comments-sheet").props.onAccessibilityEscape());
		mockGlass = false;
		await act(() => Uniwind.setTheme("light"));
	});

	it("says which kind has none when the document has no threads", async () => {
		mockThreads = [];
		await openDocument(466);
		await pressComments();
		expect(await screen.findByText("No open comments on this document.")).toBeOnTheScreen();
		await fireEvent(screen.getByTestId("comments-status"), "change", {
			nativeEvent: { selectedSegmentIndex: 1 },
		});
		expect(await screen.findByText("No resolved comments on this document.")).toBeOnTheScreen();
		await act(() => Uniwind.setTheme("light"));
	});
});
