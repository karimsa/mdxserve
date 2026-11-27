import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import type { ProbeResult } from "../src/servers/connection";
import { SERVERS_KEY, type KnownServer } from "../src/servers/store";
import { APP_ROUTES } from "./app-routes";

// The reader keeps its place (R4): ticking a box far down a long document, and a change on disk,
// refetch the document without moving the list or remounting the rows on screen.

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

const STUDIO = "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e";
const STUDIO_URL = "https://studio.tail1.ts.net";
const DOC = "/srv/example/long.md";
const DOC_URL = `/s/${STUDIO}/doc/srv/example/long.md`;
const PARAGRAPHS = 80;
/** The task list sits after this paragraph, far below the first screen. */
const TASKS_AFTER = 60;

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
const paragraph = (value: string) => ({ type: "paragraph", children: [text(value)] });

/** One long section: numbered paragraphs, with a task list partway down. */
function mockLongDocument(shipped: boolean, edited: string) {
	const children: unknown[] = [];
	for (let index = 0; index < PARAGRAPHS; index++) {
		children.push(paragraph(`Paragraph ${index}${index === 0 ? edited : ""}`));
		if (index === TASKS_AFTER) {
			children.push({
				type: "list",
				ordered: false,
				start: null,
				items: [{ checked: shipped, children: [paragraph("Ship it")] }],
			});
		}
	}
	return {
		schemaVersion: 1,
		metadata: { openGraph: [] },
		toc: [],
		children: [{ type: "section", id: "long", level: 1, heading: [text("Long")], children }],
	};
}

let mockShipped = false;
/** While set, a document read waits for it: a reload the test can look at half way. */
let mockGate: Promise<void> | null = null;
/** How many times the document has been asked for. */
let mockReads = 0;
let openGate = () => {};

function closeGate() {
	mockGate = new Promise((resolve) => {
		openGate = resolve;
	});
}
let mockEdited = "";
const mockProbeAnswers = new Map<string, ProbeResult>();
const mockSaveDocNode = jest.fn(async () => {
	mockShipped = true;
	return { version: "v2" };
});

jest.mock("../src/servers/probe", () => ({
	createProbe: () => async (origin: string) =>
		mockProbeAnswers.get(origin) ?? { kind: "failed", cause: "could not connect" },
}));

jest.mock("@mdxserve/client/api", () => ({
	createApiClient: () => ({
		getDocument: {
			query: async () => {
				mockReads += 1;
				await mockGate;
				return {
					document: mockLongDocument(mockShipped, mockEdited),
					version: mockShipped ? "v2" : "v1",
				};
			},
		},
		getNodeSource: { query: async () => ({ markdown: "# Long\n\n- [ ] Ship it", version: "v1" }) },
		saveDocNode: { mutate: mockSaveDocNode },
	}),
}));

type MockDocListeners = Set<(path: string, cause: string) => void>;
const mockDocListeners: MockDocListeners = new Set();

jest.mock("@mdxserve/client/realtime", () => ({
	createRealtime: () => ({
		joinDocument() {},
		leaveDocument() {},
		onDocChanged: (listener: (path: string, cause: string) => void) => {
			mockDocListeners.add(listener);
			return () => mockDocListeners.delete(listener);
		},
		onListingChanged: () => () => {},
		onRootsChanged: () => () => {},
		close() {},
	}),
}));

/**
 * Let the reload's state reach the screen. TanStack Query hands its updates over on a timer, and
 * this environment's timers are jest's fake ones (waitFor advances them too).
 */
async function settle() {
	for (let turn = 0; turn < 10; turn++) {
		await act(async () => {
			jest.advanceTimersByTime(10);
			await Promise.resolve();
		});
	}
}

/** The list's scroll view, its offset, and which rows are drawn. */
function list() {
	return screen.getByTestId("document-content");
}

/** The text a host element draws, its nested runs included. */
function textIn(node: unknown): string {
	if (typeof node === "string") return node;
	if (!node || typeof node !== "object") return "";
	return ((node as { children?: unknown[] }).children ?? []).map(textIn).join("");
}

function drawnParagraphs(): number[] {
	return screen
		.queryAllByText(/^Paragraph \d+/)
		.map((node) => Number(/Paragraph (\d+)/.exec(textIn(node))?.[1]));
}

/** The list kept its place: the rows drawn before are still drawn, and none above them. */
function expectSamePlace(before: number[]) {
	const now = drawnParagraphs();
	expect(now).toEqual(expect.arrayContaining(before));
	expect(Math.min(...now)).toBe(Math.min(...before));
}

/** Scroll the list to the task list's row, as a reader's finger would. */
async function scrollDown() {
	await act(async () => {
		fireEvent.scroll(list(), {
			nativeEvent: {
				contentOffset: { x: 0, y: TASKS_AFTER * 100 },
				contentSize: { width: 400, height: PARAGRAPHS * 100 },
				layoutMeasurement: { width: 400, height: 900 },
			},
		});
	});
	await waitFor(() => expect(screen.getByText("Ship it")).toBeOnTheScreen());
}

beforeEach(async () => {
	mockShipped = false;
	mockEdited = "";
	mockGate = null;
	mockSaveDocNode.mockClear();
	mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info });
	await AsyncStorage.clear();
	await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify({ servers: [known] }));
});

describe("a long document keeps its place", () => {
	it("across a tick: the pending state, the save and the reload", async () => {
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Long" });
		await scrollDown();
		const before = drawnParagraphs();
		const shipIt = screen.getByText("Ship it");
		expect(Math.min(...before)).toBeGreaterThan(40);

		closeGate();
		const reads = mockReads;
		await fireEvent.press(screen.getByRole("checkbox"));
		await waitFor(() => expect(mockReads).toBe(reads + 1));
		// The reload is under way. A programmatic refresh would move the list on iOS.
		await settle();
		expect(list().props.refreshControl.props.refreshing).toBe(false);
		expectSamePlace(before);
		await act(async () => openGate());
		await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());

		expectSamePlace(before);
		// The same row, not a remounted one.
		expect(screen.getByText("Ship it")).toBe(shipIt);
		// Never a programmatic refresh: on iOS that moves the list to show the spinner.
		expect(list().props.refreshControl.props.refreshing).toBe(false);
	});

	it("across a change on disk", async () => {
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Long" });
		await scrollDown();
		const before = drawnParagraphs();
		const shipIt = screen.getByText("Ship it");

		mockEdited = " (edited)";
		closeGate();
		const reads = mockReads;
		await act(async () => {
			for (const listener of [...mockDocListeners]) listener(DOC, "changed");
		});
		await waitFor(() => expect(mockReads).toBe(reads + 1));
		await settle();
		expect(list().props.refreshControl.props.refreshing).toBe(false);
		await act(async () => openGate());
		await waitFor(() =>
			expect(screen.queryByText("Paragraph 0 (edited)") ?? drawnParagraphs()).toBeTruthy(),
		);

		expectSamePlace(before);
		expect(screen.getByText("Ship it")).toBe(shipIt);
		expect(list().props.refreshControl.props.refreshing).toBe(false);
	});
});
