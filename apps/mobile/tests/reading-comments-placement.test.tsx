import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { StyleSheet } from "react-native";
import type { CommentThread } from "@mdxserve/client/comments/threads";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import type { ProbeResult } from "../src/servers/connection";
import { PANEL_WIDTH, panelPlacement } from "../src/comments/placement";
import { SERVERS_KEY, type KnownServer } from "../src/servers/store";
import { APP_ROUTES } from "./app-routes";

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

const mockProbeAnswers = new Map<string, ProbeResult>();

jest.mock("../src/servers/probe", () => ({
	createProbe: () => async (origin: string) =>
		mockProbeAnswers.get(origin) ?? { kind: "failed", cause: "could not connect" },
}));

jest.mock("@mdxserve/client/api", () => ({
	createApiClient: () => ({
		getDocument: { query: async () => ({ document: mockGuide, version: "v1" }) },
		getDocComments: { query: async () => ({ threads: [mockThread], diagnostics: [] }) },
	}),
}));

jest.mock("@mdxserve/client/realtime", () => ({
	createRealtime: () => ({
		joinDocument() {},
		leaveDocument() {},
		onDocChanged: () => () => {},
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

async function openPanel() {
	await waitFor(() => {
		const header = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
			(candidate) => candidate.props.title === "guide.md",
		);
		const items = (header?.props.headerRightBarButtonItems ?? []) as Array<Record<string, any>>;
		expect(items.some((item) => String(item.accessibilityLabel).startsWith("Comments"))).toBe(true);
	});
	const header = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
		(candidate) => candidate.props.title === "guide.md",
	)!;
	const item = (header.props.headerRightBarButtonItems as Array<Record<string, any>>).find(
		(entry) => String(entry.accessibilityLabel).startsWith("Comments"),
	)!;
	await act(async () => item.onPress());
	await screen.findByTestId("comments-panel");
}

beforeEach(async () => {
	await AsyncStorage.clear();
	await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify({ servers: [known] }));
	mockProbeAnswers.clear();
	mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info });
});

describe("where the comments panel goes", () => {
	it("is under the document below 600 pt and beside it from 600 pt (KA15)", () => {
		expect(panelPlacement(599)).toBe("below");
		expect(panelPlacement(600)).toBe("beside");
	});

	it("goes under the document in a narrow window, clearing the vertical bar (KA15)", async () => {
		resize({ width: 466, height: 852, scale: 3, fontScale: 1 });
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Guide" });
		await setInsets({ top: 0, right: 84, bottom: 21, left: 0 });
		await openPanel();
		const dock = styleOf("comments-dock");
		expect(dock.height).toBeGreaterThan(0);
		expect(dock.width).toBeUndefined();
		expect(styleOf("comments-panel").paddingRight).toBe(84);
		expect(styleOf("document-pane").display).toBe("flex");
		const parent = screen.getByTestId("document-pane").parent!;
		expect(StyleSheet.flatten(parent.props.style).flexDirection).toBe("column");
		expect(screen.getByLabelText("Expand comments")).toBeOnTheScreen();
	});

	it("expands over the whole height and hides the document, then shows it again (KA16)", async () => {
		resize({ width: 466, height: 852, scale: 3, fontScale: 1 });
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Guide" });
		await openPanel();
		await fireEvent.press(screen.getByLabelText("Expand comments"));
		expect(styleOf("comments-dock")).toMatchObject({ flex: 1 });
		expect(styleOf("document-pane").display).toBe("none");
		await fireEvent.press(screen.getByLabelText("Show the document"));
		expect(styleOf("comments-dock").height).toBeGreaterThan(0);
		expect(styleOf("document-pane").display).toBe("flex");
	});

	it("goes beside the document in a wide window, with no expand control (KA15)", async () => {
		resize({ width: 951, height: 669, scale: 3, fontScale: 1 });
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Guide" });
		await setInsets({ top: 59, right: 0, bottom: 34, left: 0 });
		await openPanel();
		expect(styleOf("comments-dock").width).toBe(PANEL_WIDTH);
		expect(styleOf("comments-dock").height).toBeUndefined();
		const parent = screen.getByTestId("document-pane").parent!;
		expect(StyleSheet.flatten(parent.props.style).flexDirection).toBe("row");
		expect(styleOf("document-pane").display).toBe("flex");
		expect(screen.queryByLabelText("Expand comments")).toBeNull();
	});
});
