import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import type { CommentThread } from "@mdxserve/client/comments/threads";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import type { ProbeResult } from "../src/servers/connection";
import { SERVERS_KEY, type KnownServer } from "../src/servers/store";
import { APP_ROUTES } from "./app-routes";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

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
const mockProbe = jest.fn(
	async (origin: string): Promise<ProbeResult> =>
		mockProbeAnswers.get(origin) ?? { kind: "failed", cause: "could not connect" },
);
/** Like the server: a write that lands is what the next read of the threads returns. */
async function mockWrite(answer: Promise<{ threads: CommentThread[] }>) {
	const result = await answer;
	mockThreads = result.threads;
	return result;
}
const mockAddReply = jest.fn(async (_: unknown) => ({ threads: mockThreads }));
const mockEdit = jest.fn(async (_: unknown) => ({ threads: mockThreads }));
const mockSetResolved = jest.fn(async (_: unknown) => ({ threads: mockThreads }));
const mockAddThread = jest.fn(async (_: unknown) => ({ threads: mockThreads, threadId: "" }));

// The development build's native view, as a host element the test reads the props of.
jest.mock("../modules/selectable-text", () => {
	const { createElement } = jest.requireActual<typeof import("react")>("react");
	return {
		SelectableTextView: (props: object) => createElement("SelectableTextView", props),
	};
});

jest.mock("../src/servers/probe", () => ({
	createProbe: () => (origin: string) => mockProbe(origin),
}));

jest.mock("@mdxserve/client/api", () => ({
	createApiClient: () => ({
		getDocument: { query: mockGetDocument },
		getDocComments: { query: mockGetDocComments },
		addCommentReply: { mutate: (input: unknown) => mockWrite(mockAddReply(input)) },
		editComment: { mutate: (input: unknown) => mockWrite(mockEdit(input)) },
		setCommentThreadResolved: { mutate: (input: unknown) => mockWrite(mockSetResolved(input)) },
		addCommentThread: {
			mutate: async (input: unknown) => {
				const result = await mockAddThread(input);
				mockThreads = result.threads;
				return result;
			},
		},
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

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

/** The selectable text views on screen, by the text they show. */
function selectable(): Map<string, HostElement> {
	const views = new Map<string, HostElement>();
	for (const view of allHosts(screen.toJSON(), "SelectableTextView"))
		views.set((view.props.runs as Array<{ text: string }>).map((run) => run.text).join(""), view);
	return views;
}

async function openDocument() {
	await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
	await waitFor(() => expect(selectable().has("Alpha beta gamma delta")).toBe(true));
}

/** Selects `quote` in the block that shows `block` and chooses Comment in the selection menu. */
async function comment(block: string, quote: string) {
	const view = selectable().get(block)!;
	const start = block.indexOf(quote);
	await act(async () =>
		view.props.onComment({ nativeEvent: { start, end: start + quote.length, text: quote } }),
	);
}

function draftField() {
	return screen.getByLabelText("Comment");
}

beforeEach(async () => {
	await AsyncStorage.clear();
	mockProbeAnswers.clear();
	mockDocuments.clear();
	mockAddThread.mockReset();
	mockThreads = [];
	mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
	await seed(known());
	mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info() });
});

describe("commenting on selected text (KB1)", () => {
	it("draws the document's prose as selectable text with Comment in its menu", async () => {
		await openDocument();
		expect([...selectable().keys()]).toEqual([
			"Guide",
			"Alpha beta gamma delta",
			"Second paragraph here",
			"Setup",
			"On a Mac",
			"On Linux",
		]);
		for (const view of selectable().values()) expect(view.props.commentTitle).toBe("Comment");
	});

	it("opens a new thread on the selection and creates it with the server's procedure", async () => {
		const created = thread("made", {
			heading: "Guide",
			block: "Alpha beta gamma delta",
			quote: "beta gamma",
		});
		mockAddThread.mockImplementation(async () => ({ threads: [created], threadId: "made" }));
		await openDocument();
		await comment("Alpha beta gamma delta", "beta gamma");
		const draft = await screen.findByTestId("comment-draft");
		expect(within(draft).getByText("beta gamma")).toBeOnTheScreen();
		await fireEvent.changeText(draftField(), "Why this?");
		await fireEvent.press(screen.getByRole("button", { name: "Send comment" }));
		await waitFor(() => expect(screen.queryByTestId("comment-draft")).toBeNull());
		expect(mockAddThread).toHaveBeenCalledTimes(1);
		expect(mockAddThread).toHaveBeenCalledWith({
			path: DOC,
			anchor: { heading: "Guide", block: "Alpha beta gamma delta", quote: "beta gamma" },
			body: "Why this?",
		});
		// The new thread is the active one, with its reply field.
		expect(await screen.findByText("Question made")).toBeOnTheScreen();
		expect(screen.getByLabelText("Reply")).toBeOnTheScreen();
	});

	it("keeps the typed comment and shows why when the send fails (KA13)", async () => {
		mockAddThread.mockRejectedValue(new Error("File is changing on disk; try again"));
		await openDocument();
		await comment("On a Mac", "Mac");
		await fireEvent.changeText(draftField(), "Keep me");
		await fireEvent.press(screen.getByRole("button", { name: "Send comment" }));
		expect(await screen.findByText("File is changing on disk; try again")).toBeOnTheScreen();
		expect(draftField().props.value).toBe("Keep me");
		expect(mockAddThread).toHaveBeenCalledWith({
			path: DOC,
			anchor: { heading: "Setup", block: "On a Mac", quote: "Mac" },
			body: "Keep me",
		});
	});

	it("moves an open draft to a new selection and keeps its text; Cancel drops it", async () => {
		await openDocument();
		await comment("Alpha beta gamma delta", "Alpha");
		await fireEvent.changeText(draftField(), "Draft text");
		await comment("Second paragraph here", "paragraph");
		const draft = screen.getByTestId("comment-draft");
		expect(within(draft).getByText("paragraph")).toBeOnTheScreen();
		expect(draftField().props.value).toBe("Draft text");
		await fireEvent.press(within(draft).getByRole("button", { name: "Cancel" }));
		expect(screen.queryByTestId("comment-draft")).toBeNull();
		expect(mockAddThread).not.toHaveBeenCalled();
	});

	it("keeps text typed, and a new selection made, while the comment was sending", async () => {
		const created = thread("made", {
			heading: "Guide",
			block: "Alpha beta gamma delta",
			quote: "Alpha",
		});
		const answer = deferred<{ threads: CommentThread[]; threadId: string }>();
		mockAddThread.mockImplementation(() => answer.promise);
		await openDocument();
		await comment("Alpha beta gamma delta", "Alpha");
		await fireEvent.changeText(draftField(), "First");
		await fireEvent.press(screen.getByRole("button", { name: "Send comment" }));
		await fireEvent.changeText(draftField(), "First, and more");
		await comment("Second paragraph here", "Second");
		await act(async () => answer.resolve({ threads: [created], threadId: "made" }));
		const draft = await screen.findByTestId("comment-draft");
		expect(within(draft).getByText("Second")).toBeOnTheScreen();
		expect(draftField().props.value).toBe("First, and more");
		expect(mockAddThread).toHaveBeenCalledTimes(1);
	});

	it("offers Copy only on a restricted server, which takes no writes (KA14)", async () => {
		await seed(known("restricted"));
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info("restricted") });
		await openDocument();
		for (const view of selectable().values()) expect(view.props.commentTitle).toBeUndefined();
	});
});
