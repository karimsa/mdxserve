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
const mockAddReply = jest.fn(async (_: unknown) => ({ threads: mockThreads }));
const mockEdit = jest.fn(async (_: unknown) => ({ threads: mockThreads }));
const mockSetResolved = jest.fn(async (_: unknown) => ({ threads: mockThreads }));

jest.mock("../src/servers/probe", () => ({
	createProbe: () => (origin: string) => mockProbe(origin),
}));

jest.mock("@mdxserve/client/api", () => ({
	createApiClient: () => ({
		getDocument: { query: mockGetDocument },
		getDocComments: { query: mockGetDocComments },
		addCommentReply: { mutate: mockAddReply },
		editComment: { mutate: mockEdit },
		setCommentThreadResolved: { mutate: mockSetResolved },
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

const resolvedCopy = (source: CommentThread): CommentThread => ({ ...source, resolved: true });

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

async function selectThread(quote: string) {
	await fireEvent.press(screen.getByLabelText(`Show in the document: ${quote}`));
}

async function typeReply(body: string) {
	await fireEvent.changeText(screen.getByLabelText("Reply"), body);
}

/** The text of the `role="alert"` element holding `message`, if there is one. */
/** The alert VoiceOver reads out with this message, or null. */
function alertWith(message: string) {
	return screen.queryAllByRole("alert").find((alert) => within(alert).queryByText(message)) ?? null;
}

function sendButton() {
	return screen.getByRole("button", { name: "Send reply" });
}

beforeEach(async () => {
	await AsyncStorage.clear();
	mockProbeAnswers.clear();
	mockProbe.mockClear();
	mockDocuments.clear();
	mockGetDocument.mockClear();
	mockGetDocComments.mockClear();
	mockAddReply.mockReset();
	mockEdit.mockReset();
	mockSetResolved.mockReset();
	mockThreads = [];
	mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
	await seed(known());
	mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info() });
});

describe("writing comments on a document", () => {
	it("sends a reply and empties the field (KA5)", async () => {
		mockThreads = [BETA];
		mockAddReply.mockImplementation(async () => ({
			threads: [thread("beta", BETA.anchor, { replies: ["Thanks, fixed"] })],
		}));
		await openDocument();
		await openPanel();
		await selectThread("beta gamma");
		await typeReply("Please check");
		await fireEvent.press(sendButton());
		expect(await screen.findByText("Thanks, fixed")).toBeOnTheScreen();
		expect(mockAddReply).toHaveBeenCalledTimes(1);
		expect(mockAddReply).toHaveBeenCalledWith({
			path: DOC,
			threadId: "beta",
			body: "Please check",
		});
		await waitFor(() => expect(screen.getByLabelText("Reply").props.value).toBe(""));
	});

	it("resolves a thread and reopens it (KA6, KA7)", async () => {
		mockThreads = [BETA, SECOND];
		mockSetResolved.mockImplementationOnce(async () => ({ threads: [resolvedCopy(BETA), SECOND] }));
		mockSetResolved.mockImplementationOnce(async () => ({ threads: [BETA, SECOND] }));
		await openDocument();
		await openPanel();
		expect(screen.getByRole("tab", { name: "Open 2" })).toBeOnTheScreen();
		await fireEvent.press(
			within(screen.getByTestId("thread-beta")).getByRole("button", { name: "Resolve thread" }),
		);
		expect(await screen.findByRole("tab", { name: "Open 1" })).toBeOnTheScreen();
		expect(screen.getByRole("tab", { name: "Resolved 1" })).toBeOnTheScreen();
		expect(mockSetResolved).toHaveBeenLastCalledWith({
			path: DOC,
			threadId: "beta",
			resolved: true,
		});
		expect(screen.queryByTestId("thread-beta")).toBeNull();
		await fireEvent.press(screen.getByRole("tab", { name: "Resolved 1" }));
		await fireEvent.press(
			within(screen.getByTestId("thread-beta")).getByRole("button", { name: "Reopen thread" }),
		);
		expect(await screen.findByRole("tab", { name: "Open 2" })).toBeOnTheScreen();
		expect(mockSetResolved).toHaveBeenLastCalledWith({
			path: DOC,
			threadId: "beta",
			resolved: false,
		});
		expect(screen.getByRole("tab", { name: "Resolved 0" })).toBeOnTheScreen();
	});

	it("edits a person's message, and offers no edit on an agent's (KA8)", async () => {
		const withAgent = thread("beta", BETA.anchor, { replies: ["From the agent"] });
		mockThreads = [withAgent];
		mockEdit.mockImplementation(async () => ({
			threads: [
				{
					...withAgent,
					messages: [
						{
							...withAgent.messages[0],
							body: "Question, reworded",
							editedAt: "2026-11-27T12:10:00.000Z",
						},
						withAgent.messages[1],
					],
				} as CommentThread,
			],
		}));
		await openDocument();
		await openPanel();
		expect(screen.getAllByLabelText("Edit comment")).toHaveLength(1);
		await fireEvent.press(screen.getByLabelText("Edit comment"));
		const field = screen.getByLabelText("Edit comment");
		expect(field.props.value).toBe("Question beta");
		await fireEvent.changeText(field, "Question, reworded");
		await fireEvent.press(screen.getByRole("button", { name: "Save comment" }));
		expect(await screen.findByText("Question, reworded")).toBeOnTheScreen();
		expect(screen.getByText(/· edited/)).toBeOnTheScreen();
		expect(mockEdit).toHaveBeenCalledTimes(1);
		expect(mockEdit).toHaveBeenCalledWith({
			path: DOC,
			threadId: "beta",
			messageId: "beta-1",
			body: "Question, reworded",
		});
	});

	it("keeps an edit typed while the save was on its way", async () => {
		mockThreads = [BETA];
		const saving = deferred<{ threads: CommentThread[] }>();
		mockEdit.mockImplementation(() => saving.promise);
		await openDocument();
		await openPanel();
		await fireEvent.press(screen.getByLabelText("Edit comment"));
		await fireEvent.changeText(screen.getByLabelText("Edit comment"), "First wording");
		await fireEvent.press(screen.getByRole("button", { name: "Save comment" }));
		await fireEvent.changeText(screen.getByLabelText("Edit comment"), "Second wording");
		await act(async () => saving.resolve({ threads: [BETA] }));
		// The saved text was the first; the field stays open with the second, unsaved.
		await waitFor(() =>
			expect(screen.getByLabelText("Edit comment").props.value).toBe("Second wording"),
		);
		expect(mockEdit).toHaveBeenCalledWith(expect.objectContaining({ body: "First wording" }));
	});

	it("keeps saving an edit in one thread apart from a message with the same id in another", async () => {
		// Message ids are unique only within their thread.
		const sameId = (source: CommentThread): CommentThread => ({
			...source,
			messages: [{ ...source.messages[0], id: "m1" }],
		});
		mockThreads = [sameId(BETA), sameId(SECOND)];
		const saving = deferred<{ threads: CommentThread[] }>();
		mockEdit.mockImplementation(() => saving.promise);
		await openDocument();
		await openPanel();
		const first = () => within(screen.getByTestId("thread-beta"));
		const second = () => within(screen.getByTestId("thread-second"));
		await fireEvent.press(first().getByRole("button", { name: "Edit comment" }));
		await fireEvent.changeText(first().getByLabelText("Edit comment"), "First thread, reworded");
		await fireEvent.press(first().getByRole("button", { name: "Save comment" }));
		await waitFor(() =>
			expect(first().getByRole("button", { name: "Save comment" })).toBeDisabled(),
		);
		await fireEvent.press(second().getByRole("button", { name: "Edit comment" }));
		await fireEvent.changeText(second().getByLabelText("Edit comment"), "Second thread, reworded");
		expect(second().getByRole("button", { name: "Save comment" })).toBeEnabled();
		await act(async () => saving.resolve({ threads: mockThreads }));
	});

	it("lets the panel's controls take a tap while the keyboard is up", async () => {
		mockThreads = [BETA];
		await openDocument();
		await openPanel();
		expect(screen.getByTestId("comments-list").props.keyboardShouldPersistTaps).toBe("handled");
	});

	it("keeps the typed reply and shows the failure until a send works (KA13)", async () => {
		mockThreads = [BETA];
		mockAddReply.mockRejectedValueOnce(new Error("Unreachable"));
		mockAddReply.mockImplementationOnce(async () => ({
			threads: [thread("beta", BETA.anchor, { replies: ["Landed"] })],
		}));
		await openDocument();
		await openPanel();
		await selectThread("beta gamma");
		await typeReply("Will retry");
		await fireEvent.press(sendButton());
		await screen.findByText("Unreachable");
		expect(alertWith("Unreachable")).not.toBeNull();
		expect(screen.getByLabelText("Reply").props.value).toBe("Will retry");
		await fireEvent.press(sendButton());
		expect(await screen.findByText("Landed")).toBeOnTheScreen();
		expect(screen.queryByText("Unreachable")).toBeNull();
		await waitFor(() => expect(screen.getByLabelText("Reply").props.value).toBe(""));
		expect(mockAddReply).toHaveBeenCalledTimes(2);
	});

	it("sends nothing on a second press while a reply is saving", async () => {
		mockThreads = [BETA];
		const first = deferred<{ threads: CommentThread[] }>();
		mockAddReply.mockImplementation(() => first.promise);
		await openDocument();
		await openPanel();
		await selectThread("beta gamma");
		await typeReply("Once only");
		await fireEvent.press(sendButton());
		await waitFor(() => expect(sendButton()).toBeDisabled());
		await fireEvent.press(sendButton());
		expect(mockAddReply).toHaveBeenCalledTimes(1);
		await act(async () => first.resolve({ threads: [BETA] }));
		await waitFor(() => expect(screen.getByLabelText("Reply").props.value).toBe(""));
		expect(mockAddReply).toHaveBeenCalledTimes(1);
	});

	it("sends a document's writes to the server in order", async () => {
		mockThreads = [BETA, SECOND];
		const resolving = deferred<{ threads: CommentThread[] }>();
		const replying = deferred<{ threads: CommentThread[] }>();
		mockSetResolved.mockImplementation(() => resolving.promise);
		mockAddReply.mockImplementation(() => replying.promise);
		await openDocument();
		await openPanel();
		await selectThread("paragraph");
		await fireEvent.press(
			within(screen.getByTestId("thread-beta")).getByRole("button", { name: "Resolve thread" }),
		);
		await typeReply("Second thread reply");
		await fireEvent.press(sendButton());
		await waitFor(() => expect(mockSetResolved).toHaveBeenCalledTimes(1));
		expect(mockAddReply).not.toHaveBeenCalled();
		await act(async () => resolving.resolve({ threads: [resolvedCopy(BETA), SECOND] }));
		await waitFor(() => expect(mockAddReply).toHaveBeenCalledTimes(1));
		await act(async () => replying.resolve({ threads: [resolvedCopy(BETA), SECOND] }));
		expect(mockAddReply).toHaveBeenCalledWith({
			path: DOC,
			threadId: "second",
			body: "Second thread reply",
		});
	});

	it("shows a FORBIDDEN write's message and checks the server again", async () => {
		mockThreads = [BETA];
		mockAddReply.mockRejectedValue(
			Object.assign(new Error("Mutations are disabled in restricted mode"), {
				data: { code: "FORBIDDEN" },
			}),
		);
		await openDocument();
		await openPanel();
		await selectThread("beta gamma");
		await typeReply("Not allowed");
		const probes = mockProbe.mock.calls.length;
		await fireEvent.press(sendButton());
		await screen.findByText("Mutations are disabled in restricted mode");
		expect(alertWith("Mutations are disabled in restricted mode")).not.toBeNull();
		await waitFor(() => expect(mockProbe.mock.calls.length).toBeGreaterThan(probes));
		expect(screen.getByLabelText("Reply").props.value).toBe("Not allowed");
	});

	it("checks the server's addresses again when a write gets no answer", async () => {
		mockThreads = [BETA];
		// What tRPC throws when the request never reached the server.
		mockAddReply.mockRejectedValue(
			Object.assign(new Error("Network request failed"), { name: "TRPCClientError" }),
		);
		await openDocument();
		await openPanel();
		await selectThread("beta gamma");
		await typeReply("Lost on the way");
		const probes = mockProbe.mock.calls.length;
		await fireEvent.press(sendButton());
		await screen.findByText("Network request failed");
		await waitFor(() => expect(mockProbe.mock.calls.length).toBeGreaterThan(probes));
		// The write itself is not sent again on its own: it may have reached the server.
		expect(mockAddReply).toHaveBeenCalledTimes(1);
		expect(screen.getByLabelText("Reply").props.value).toBe("Lost on the way");
	});

	it("offers no write control on a restricted server (KA14)", async () => {
		await seed(known("restricted"));
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info("restricted") });
		mockThreads = [BETA];
		await openDocument();
		await openPanel();
		await selectThread("beta gamma");
		expect(screen.getByTestId("thread-beta")).toBeOnTheScreen();
		expect(screen.queryByLabelText("Reply")).toBeNull();
		expect(screen.queryByLabelText("Resolve thread")).toBeNull();
		expect(screen.queryByLabelText("Edit comment")).toBeNull();
	});
});
