import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import { StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import type { CommentThread } from "@mdxserve/client/comments/threads";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import type { ProbeResult } from "../src/servers/connection";
import { SERVERS_KEY, type KnownServer } from "../src/servers/store";
import { APP_ROUTES } from "./app-routes";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

const sheet = loadCompiledStylesheet();

const STUDIO = "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e";
const STUDIO_URL = "https://studio.tail1.ts.net";
const DOC = "/srv/example/guide.md";
const DOC_URL = `/s/${STUDIO}/doc/srv/example/guide.md`;

function info(permissions: "full" | "restricted" = "full"): ServerInfo {
	return {
		id: STUDIO,
		name: "Studio",
		version: "0.7.0",
		permissions,
		mermaidVersion: "10.9.8",
		treeSchemaVersion: 1,
		tailnetUrls: [],
	};
}

function known(permissions: "full" | "restricted" = "full"): KnownServer {
	return {
		id: STUDIO,
		name: "Studio",
		version: "0.7.0",
		permissions,
		treeSchemaVersion: 1,
		addedAt: "2026-11-27T12:00:00.000Z",
		addresses: [{ url: STUDIO_URL, source: "manual" }],
	};
}

const text = (value: string) => ({ type: "text", value });
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });

/** A guide: a title section holding two paragraphs, and a Setup section with tabs. */
function guide() {
	return {
		schemaVersion: 1,
		metadata: { openGraph: [] },
		toc: [{ id: "setup", label: "Setup", kind: "heading", children: [] }],
		children: [
			{
				type: "section",
				id: "guide",
				level: 1,
				heading: [text("Guide")],
				children: [
					paragraph(text("Alpha beta gamma delta")),
					paragraph(text("Second paragraph here")),
					{
						type: "section",
						id: "setup",
						level: 2,
						heading: [text("Setup")],
						children: [
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
										children: [paragraph(text("On Linux"))],
									},
								],
							},
						],
					},
				],
			},
		],
	};
}

function thread(
	id: string,
	anchor: { heading: string | null; block: string; quote: string },
	options: { resolved?: boolean; replies?: string[] } = {},
): CommentThread {
	return {
		id,
		resolved: options.resolved ?? false,
		anchor,
		messages: [
			{
				id: `${id}-1`,
				author: "human",
				body: `Question ${id}`,
				createdAt: "2026-11-27T12:00:00.000Z",
			},
			...(options.replies ?? []).map((body, position) => ({
				id: `${id}-r${position}`,
				author: "agent" as const,
				body,
				createdAt: "2026-11-27T12:05:00.000Z",
			})),
		],
	} as CommentThread;
}

const BETA = thread("beta", {
	heading: "Guide",
	block: "Alpha beta gamma delta",
	quote: "beta gamma",
});
const SECOND = thread("second", {
	heading: "Guide",
	block: "Second paragraph here",
	quote: "paragraph",
});
const DONE = thread(
	"done",
	{ heading: "Guide", block: "Alpha beta gamma delta", quote: "delta" },
	{ resolved: true },
);
const LINUX = thread("linux", { heading: "Setup", block: "On Linux", quote: "Linux" });

let mockThreads: CommentThread[] = [];
const mockDocuments = new Map<string, () => unknown>();
const mockGetDocument = jest.fn(async ({ path }: { path: string }) => {
	const answer = mockDocuments.get(path);
	if (!answer)
		throw Object.assign(new Error(`Not found: ${path}`), { data: { code: "NOT_FOUND" } });
	return answer();
});
const mockGetDocComments = jest.fn(async (_: { path: string }) => ({
	threads: mockThreads,
	diagnostics: [],
}));
const mockScrollToIndex = jest.fn();
const mockProbeAnswers = new Map<string, ProbeResult>();

jest.mock("../src/servers/probe", () => ({
	createProbe: () => async (origin: string) =>
		mockProbeAnswers.get(origin) ?? { kind: "failed", cause: "could not connect" },
}));

jest.mock("@mdxserve/client/api", () => ({
	createApiClient: () => ({
		getDocument: { query: mockGetDocument },
		getDocComments: { query: mockGetDocComments },
	}),
}));

// The list's scrollToIndex is what moves the document to a thread's text, so the test watches it.
jest.mock("@shopify/flash-list", () => {
	const actual = jest.requireActual<typeof import("@shopify/flash-list")>("@shopify/flash-list");
	const { createElement } = jest.requireActual<typeof import("react")>("react");
	return {
		...actual,
		FlashList: ({ ref, ...props }: { ref?: { current: unknown } }) =>
			createElement(actual.FlashList as never, {
				...props,
				ref: (handle: { scrollToIndex: unknown } | null) => {
					if (handle) handle.scrollToIndex = mockScrollToIndex;
					if (ref) ref.current = handle;
				},
			}),
	};
});

type MockDocListeners = Set<(path: string, cause: string) => void>;
const mockSockets = new Map<string, { docListeners: MockDocListeners }>();

jest.mock("@mdxserve/client/realtime", () => ({
	createRealtime: (origin: string) => {
		const socket = { docListeners: new Set() as MockDocListeners };
		mockSockets.set(origin, socket);
		return {
			joinDocument() {},
			leaveDocument() {},
			onDocChanged: (listener: (path: string, cause: string) => void) => {
				socket.docListeners.add(listener);
				return () => socket.docListeners.delete(listener);
			},
			onListingChanged: () => () => {},
			onRootsChanged: () => () => {},
			close() {},
		};
	},
}));

async function seed(server: KnownServer) {
	await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify({ servers: [server] }));
}

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

/** The header's trailing items, as the native stack receives them. */
function headerItems(): Array<Record<string, any>> {
	const header = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
		(candidate) => candidate.props.title === "guide.md",
	);
	return (header?.props.headerRightBarButtonItems ?? []) as Array<Record<string, any>>;
}

function commentsItem() {
	return headerItems().find((item) => String(item.accessibilityLabel ?? "").startsWith("Comments"));
}

async function openDocument() {
	await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
	await screen.findByRole("heading", { name: "Guide" });
}

async function openPanel() {
	await waitFor(() => expect(commentsItem()).toBeDefined());
	await act(async () => commentsItem()!.onPress());
	await screen.findByTestId("comments-panel");
}

function background(host: { props: { style?: unknown } }) {
	return StyleSheet.flatten(host.props.style as never)?.backgroundColor;
}

/** A word drawn in the document (not in the panel). */
function inDocument(word: string) {
	return within(screen.getByTestId("document-pane")).getByText(word);
}

beforeEach(async () => {
	await AsyncStorage.clear();
	mockProbeAnswers.clear();
	mockDocuments.clear();
	mockGetDocument.mockClear();
	mockGetDocComments.mockClear();
	mockScrollToIndex.mockClear();
	mockThreads = [];
	mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
});

afterEach(async () => {
	await act(() => Uniwind.setTheme("light"));
});

describe.each(["light", "dark"] as const)("comments on a document (%s)", (theme) => {
	const { variables } = resolveTheme(sheet, theme);

	beforeEach(async () => {
		await act(() => Uniwind.setTheme(theme));
		await seed(known());
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info() });
	});

	it("lists open and resolved threads on their own tabs (KA1)", async () => {
		mockThreads = [BETA, SECOND, DONE];
		await openDocument();
		expect(screen.queryByText(/^Unsupported /)).toBeNull();
		expect(commentsItem()?.accessibilityLabel).toBe("Comments, 2 open");
		await openPanel();
		expect(screen.getByRole("tab", { name: "Open 2", selected: true })).toBeOnTheScreen();
		expect(screen.getByRole("tab", { name: "Resolved 1" })).toBeOnTheScreen();
		expect(screen.getByTestId("thread-beta")).toBeOnTheScreen();
		expect(screen.getByTestId("thread-second")).toBeOnTheScreen();
		expect(screen.queryByTestId("thread-done")).toBeNull();
		await fireEvent.press(screen.getByRole("tab", { name: "Resolved 1" }));
		expect(screen.getByTestId("thread-done")).toBeOnTheScreen();
		expect(screen.queryByTestId("thread-beta")).toBeNull();
	});

	it("draws the quoted words with the mark colour, and opens the thread when pressed (KA2, KA3)", async () => {
		mockThreads = [BETA, SECOND];
		await openDocument();
		await waitFor(() =>
			expect(background(inDocument("beta gamma"))).toBe(variables["--comment-mark"]),
		);
		expect(background(inDocument("paragraph"))).toBe(variables["--comment-mark"]);
		await fireEvent.press(inDocument("beta gamma"));
		await screen.findByTestId("comments-panel");
		await waitFor(() =>
			expect(background(inDocument("beta gamma"))).toBe(variables["--comment-mark-active"]),
		);
		expect(background(within(screen.getByTestId("thread-beta")).getByText("beta gamma"))).toBe(
			variables["--comment-mark-active"],
		);
	});

	it("selects the tab a chosen thread's text is in, and scrolls to its row (KA4)", async () => {
		mockThreads = [LINUX];
		await openDocument();
		expect(screen.getByRole("tab", { name: "macOS", selected: true })).toBeOnTheScreen();
		await openPanel();
		await fireEvent.press(screen.getByLabelText("Show in the document: Linux"));
		expect(await screen.findByRole("tab", { name: "Linux", selected: true })).toBeOnTheScreen();
		const marker = screen.getByLabelText("1 comment");
		const row = Number(String(marker.props.testID).replace("row-marker-", ""));
		await waitFor(() =>
			expect(mockScrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: row })),
		);
		expect(row).toBeGreaterThan(0);
	});

	it("shows a reply written elsewhere after the server says the document changed (KA12)", async () => {
		mockThreads = [BETA];
		await openDocument();
		await openPanel();
		expect(screen.queryByText("Fixed it")).toBeNull();
		const reads = mockGetDocComments.mock.calls.length;
		mockThreads = [thread("beta", BETA.anchor, { replies: ["Fixed it"] })];
		await act(async () => {
			for (const listener of mockSockets.get(STUDIO_URL)?.docListeners ?? [])
				listener(DOC, "changed");
		});
		expect(await screen.findByText("Fixed it")).toBeOnTheScreen();
		expect(mockGetDocComments.mock.calls.length).toBeGreaterThan(reads);
		expect(mockGetDocComments).toHaveBeenLastCalledWith({ path: DOC });
	});

	it("shows a restricted server's threads, and no Comments item without any (KA14)", async () => {
		await seed(known("restricted"));
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info("restricted") });
		mockThreads = [BETA];
		await openDocument();
		await openPanel();
		expect(screen.getByTestId("thread-beta")).toBeOnTheScreen();
	});

	it("has no Comments item on a restricted server whose document has no threads (KA14)", async () => {
		await seed(known("restricted"));
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info("restricted") });
		await openDocument();
		await waitFor(() => expect(mockGetDocComments).toHaveBeenCalled());
		expect(headerItems().some((item) => item.accessibilityLabel === "Contents")).toBe(true);
		expect(commentsItem()).toBeUndefined();
	});

	it("says where a thread whose text or section is gone is shown (KA18)", async () => {
		mockThreads = [
			thread("moved", { heading: "Guide", block: "Text that was deleted", quote: "deleted" }),
			thread("gone", { heading: "Removed section", block: "Old text", quote: "Old" }),
		];
		await openDocument();
		await openPanel();
		expect(
			within(screen.getByTestId("thread-moved")).getByText(
				"Original text not found. Showing on the section.",
			),
		).toBeOnTheScreen();
		expect(
			within(screen.getByTestId("thread-gone")).getByText("Original section not found."),
		).toBeOnTheScreen();
		expect(screen.getByText("Detached")).toBeOnTheScreen();
		expect(screen.getByRole("tab", { name: "Open 2" })).toBeOnTheScreen();
	});

	it("marks a row with its open threads, and opens the first when pressed (KA17)", async () => {
		mockThreads = [
			BETA,
			thread("delta", { heading: "Guide", block: "Alpha beta gamma delta", quote: "Alpha" }),
			SECOND,
		];
		await openDocument();
		const several = await screen.findByLabelText("2 comments");
		const single = screen.getByLabelText("1 comment");
		expect(several).toBeOnTheScreen();
		await fireEvent.press(single);
		await screen.findByTestId("comments-panel");
		expect(
			screen.getByRole("button", { name: "Show in the document: paragraph", selected: true }),
		).toBeOnTheScreen();
		await fireEvent.press(screen.getByLabelText("Close comments"));
		await waitFor(() => expect(screen.queryByTestId("comments-panel")).toBeNull());
		await fireEvent.press(screen.getByLabelText("2 comments"));
		await screen.findByTestId("comments-panel");
		// Both threads sit in one block, so the file's order decides: "beta gamma" came first.
		expect(
			screen.getByRole("button", { name: "Show in the document: beta gamma", selected: true }),
		).toBeOnTheScreen();
	});

	it("says the comments could not be loaded, and loads them on Retry", async () => {
		mockGetDocComments.mockRejectedValue(new Error("The server hiccuped"));
		await openDocument();
		await openPanel();
		expect(await screen.findByText("Comments could not be loaded.")).toBeOnTheScreen();
		expect(screen.getByText("The server hiccuped")).toBeOnTheScreen();
		expect(screen.queryByText(/^Unsupported /)).toBeNull();
		expect(screen.getByRole("heading", { name: "Guide" })).toBeOnTheScreen();
		mockThreads = [BETA];
		mockGetDocComments.mockImplementation(async () => ({ threads: mockThreads, diagnostics: [] }));
		const calls = mockGetDocComments.mock.calls.length;
		await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByTestId("thread-beta")).toBeOnTheScreen();
		expect(mockGetDocComments.mock.calls.length).toBeGreaterThan(calls);
	});
});
