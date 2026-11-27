import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import { Alert, Linking } from "react-native";
import { Uniwind } from "uniwind";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import type { ProbeResult } from "../src/servers/connection";
import { SERVERS_KEY, type KnownServer } from "../src/servers/store";
import { APP_ROUTES } from "./app-routes";
import markdownTour from "./fixtures/01-markdown.md.json";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

const STUDIO = "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e";
const STUDIO_URL = "https://studio.tail1.ts.net";
const DOC = "/srv/example/guide.md";
const DOC_URL = `/s/${STUDIO}/doc/srv/example/guide.md`;

function info(permissions: "full" | "restricted" = "full", treeSchemaVersion = 1): ServerInfo {
	return {
		id: STUDIO,
		name: "Studio",
		version: "0.7.0",
		permissions,
		mermaidVersion: "10.9.8",
		treeSchemaVersion,
		tailnetUrls: [],
	};
}

function known(permissions: "full" | "restricted" = "full", treeSchemaVersion = 1): KnownServer {
	return {
		id: STUDIO,
		name: "Studio",
		version: "0.7.0",
		permissions,
		treeSchemaVersion,
		addedAt: "2026-11-27T12:00:00.000Z",
		addresses: [{ url: STUDIO_URL, source: "manual" }],
	};
}

const text = (value: string) => ({ type: "text", value });
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });

/** A small document with one of each thing the screen handles itself. */
function guide({ shipped = false, extra = "" } = {}) {
	return {
		schemaVersion: 1,
		metadata: { openGraph: [] },
		toc: [
			{ id: "setup", label: "Setup", kind: "heading", children: [] },
			{
				id: "os",
				label: "os",
				kind: "heading",
				children: [{ id: "os>linux", label: "Linux", kind: "tab", children: [] }],
			},
		],
		children: [
			{
				type: "section",
				id: "guide",
				level: 1,
				heading: [text("Guide")],
				children: [
					paragraph(
						text("See "),
						{
							type: "link",
							href: "./other.md#install",
							title: null,
							children: [text("the other one")],
						},
						text(", "),
						{ type: "link", href: "#setup", title: null, children: [text("setup")] },
						text(" and "),
						{
							type: "link",
							href: "https://example.com/",
							title: null,
							children: [text("the web")],
						},
						text(extra),
					),
					paragraph({
						type: "image",
						src: "/__mdxserve/getAsset?path=%2Fsrv%2Fexample%2Flogo.png",
						alt: "The logo",
						title: null,
					}),
					{
						type: "section",
						id: "setup",
						level: 2,
						heading: [text("Setup")],
						children: [
							{
								type: "list",
								ordered: false,
								start: null,
								items: [
									{ checked: true, children: [paragraph(text("Install"))] },
									{ checked: shipped, children: [paragraph(text("Ship it"))] },
								],
							},
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
							{ type: "error", id: "~error-1", message: "Unexpected character", source: "<Broken" },
						],
					},
				],
			},
		],
	};
}

const SETUP_SOURCE = '## Setup\n\n- [x] Install\n- [ ] Ship it\n\n<Tabs id="os">…</Tabs>';

const mockDocuments = new Map<string, () => unknown>();
const mockGetDocument = jest.fn(async ({ path }: { path: string }) => {
	const answer = mockDocuments.get(path);
	if (!answer)
		throw Object.assign(new Error(`Not found: ${path}`), { data: { code: "NOT_FOUND" } });
	return answer();
});
const mockGetNodeSource = jest.fn(async (_: { path: string; id: string }) => ({
	markdown: SETUP_SOURCE,
	version: "v1",
}));
const mockSaveDocNode = jest.fn(
	async (_: { path: string; id: string; version: string; markdown: string }) => ({
		version: "v2",
	}),
);
const mockProbeAnswers = new Map<string, ProbeResult>();

jest.mock("../src/servers/probe", () => ({
	createProbe: () => async (origin: string) =>
		mockProbeAnswers.get(origin) ?? { kind: "failed", cause: "could not connect" },
}));

jest.mock("@mdxserve/client/api", () => ({
	createApiClient: () => ({
		getDocument: { query: mockGetDocument },
		getNodeSource: { query: mockGetNodeSource },
		saveDocNode: { mutate: mockSaveDocNode },
	}),
}));

type MockDocListeners = Set<(path: string, cause: string) => void>;

/** The live update sockets the screen opened, by origin, with a way to send their signals. */
const mockSockets = new Map<string, { joined: string[]; docListeners: MockDocListeners }>();

jest.mock("@mdxserve/client/realtime", () => ({
	createRealtime: (origin: string) => {
		const socket = { joined: [] as string[], docListeners: new Set() as MockDocListeners };
		mockSockets.set(origin, socket);
		return {
			joinDocument: (path: string) => socket.joined.push(path),
			leaveDocument: (path: string) => {
				socket.joined = socket.joined.filter((joined) => joined !== path);
			},
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

beforeEach(async () => {
	await AsyncStorage.clear();
	mockProbeAnswers.clear();
	mockDocuments.clear();
	mockGetDocument.mockClear();
	mockGetNodeSource.mockClear();
	mockSaveDocNode.mockClear();
});

afterEach(async () => {
	await act(() => Uniwind.setTheme("light"));
});

describe.each(["light", "dark"] as const)("a document (%s)", (theme) => {
	beforeEach(async () => {
		await act(() => Uniwind.setTheme(theme));
		await seed(known());
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info() });
	});

	it("renders an example document's tree, with its title as a heading in the content", async () => {
		mockDocuments.set("/srv/example/01-markdown.md", () => markdownTour);
		await renderRouter(APP_ROUTES, { initialUrl: `/s/${STUDIO}/doc/srv/example/01-markdown.md` });
		expect(await screen.findByRole("heading", { name: "Markdown tour" })).toBeOnTheScreen();
		expect(screen.queryByText(/^Unsupported /)).toBeNull();
		const header = headerTitled("01-markdown.md");
		const [left] = allHosts(header, "RNSScreenStackHeaderSubview");
		expect(left.props.type).toBe("left");
	});

	it("puts Contents, an icon, and the server's name at the header's trailing edge", async () => {
		mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Guide" });
		const items = headerTitled("guide.md").props.headerRightBarButtonItems as Array<
			Record<string, any>
		>;
		expect(items[0]).toMatchObject({
			accessibilityLabel: "Contents",
			icon: { name: "list.bullet" },
		});
		expect(screen.getByTestId("header-server-name")).toHaveTextContent("Studio");
	});

	it("opens the table of contents and reveals a tab, selecting it on the way", async () => {
		mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Guide" });
		expect(screen.getByRole("tab", { name: "macOS", selected: true })).toBeOnTheScreen();
		const items = headerTitled("guide.md").props.headerRightBarButtonItems as Array<
			Record<string, any>
		>;
		await act(async () => items[0].onPress());
		expect(await screen.findByTestId("toc-sheet")).toBeOnTheScreen();
		await fireEvent.press(screen.getByLabelText("Tab Linux"));
		expect(await screen.findByRole("tab", { name: "Linux", selected: true })).toBeOnTheScreen();
	});

	it("reveals the node a route names on open (a search result)", async () => {
		mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
		await renderRouter(APP_ROUTES, { initialUrl: `${DOC_URL}?node=os%3Elinux` });
		expect(await screen.findByRole("tab", { name: "Linux", selected: true })).toBeOnTheScreen();
	});

	it("loads an image from the server's getAsset URL, labelled with its alt text", async () => {
		mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		const image = await screen.findByLabelText("The logo");
		expect(JSON.stringify(image.props)).toContain(
			`${STUDIO_URL}/__mdxserve/getAsset?path=%2Fsrv%2Fexample%2Flogo.png`,
		);
	});

	it("follows a link to another document, a heading, and a web page (R6)", async () => {
		const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
		mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
		mockDocuments.set("/srv/example/other.md", () => markdownTour);
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await fireEvent.press(await screen.findByText("the web"));
		expect(openURL).toHaveBeenCalledWith("https://example.com/");
		await fireEvent.press(screen.getByText("setup"));
		expect(screen).toHavePathname(DOC_URL);
		await fireEvent.press(screen.getByText("the other one"));
		expect(screen).toHavePathname(`/s/${STUDIO}/doc/srv/example/other.md`);
		expect(screen).toHaveSearchParams({
			node: "install",
			serverId: STUDIO,
			path: ["srv", "example", "other.md"],
		});
		expect(await screen.findByRole("heading", { name: "Markdown tour" })).toBeOnTheScreen();
		openURL.mockRestore();
	});

	it("shows a section the server could not read, with a note above the document", async () => {
		mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		expect(
			await screen.findByText(
				"One part of this document could not be read. It is shown as its source.",
			),
		).toBeOnTheScreen();
		expect(
			screen.getByText("This section could not be read: Unexpected character"),
		).toBeOnTheScreen();
	});

	it("ticks a task box at once and writes it to the file (R7)", async () => {
		let shipped = false;
		mockDocuments.set(DOC, () => ({
			document: guide({ shipped }),
			version: shipped ? "v2" : "v1",
		}));
		mockSaveDocNode.mockImplementationOnce(async () => {
			shipped = true;
			return { version: "v2" };
		});
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Guide" });
		const [, ship] = screen.getAllByRole("checkbox");
		expect(ship).not.toBeChecked();
		await fireEvent.press(ship);
		await waitFor(() =>
			expect(mockSaveDocNode).toHaveBeenCalledWith({
				path: DOC,
				id: "setup",
				version: "v1",
				markdown: SETUP_SOURCE.replace("- [ ] Ship it", "- [x] Ship it"),
			}),
		);
		expect(mockGetNodeSource).toHaveBeenCalledWith({ path: DOC, id: "setup" });
		await waitFor(() => expect(screen.getAllByRole("checkbox")[1]).toBeChecked());
	});

	it("puts a box back and says why when the write fails", async () => {
		const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
		mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
		mockSaveDocNode.mockRejectedValueOnce(new Error("File changed on disk"));
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Guide" });
		await fireEvent.press(screen.getAllByRole("checkbox")[1]);
		await waitFor(() =>
			expect(alert).toHaveBeenCalledWith("The checkbox was not changed", "File changed on disk"),
		);
		expect(screen.getAllByRole("checkbox")[1]).not.toBeChecked();
		alert.mockRestore();
	});

	it("refetches the document when the server says it changed (R4)", async () => {
		let extra = "";
		mockDocuments.set(DOC, () => ({ document: guide({ extra }), version: `v-${extra}` }));
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Guide" });
		const socket = mockSockets.get(STUDIO_URL);
		expect(socket?.joined).toEqual([DOC]);
		extra = " (edited on the Mac)";
		await act(async () => {
			for (const listener of socket?.docListeners ?? []) listener(DOC, "changed");
		});
		expect(await screen.findByText(/edited on the Mac/)).toBeOnTheScreen();
	});
});

describe("a document that cannot be shown", () => {
	beforeEach(async () => {
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info() });
	});

	it("says a missing document is not on the server", async () => {
		await seed(known());
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		expect(
			await screen.findByText(
				"This document is not on the server, or the server will not show it.",
			),
		).toBeOnTheScreen();
	});

	it("says the server is unreachable, as the Library does", async () => {
		await seed(known());
		mockProbeAnswers.clear();
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		expect(await screen.findByText("Pull down to try again.")).toBeOnTheScreen();
		expect(within(screen.getByTestId("document-state")).getByText("Unreachable")).toBeOnTheScreen();
	});

	it("asks for an app update for a newer tree schema", async () => {
		await seed(known());
		mockDocuments.set(DOC, () => ({ document: { ...guide(), schemaVersion: 2 }, version: "v1" }));
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		expect(await screen.findByText("Update the app to read this server.")).toBeOnTheScreen();
	});

	it("shows the boxes of a restricted server as they are, not to be ticked", async () => {
		await seed(known("restricted"));
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info("restricted") });
		mockDocuments.set(DOC, () => ({ document: guide(), version: "v1" }));
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		await screen.findByRole("heading", { name: "Guide" });
		await fireEvent.press(screen.getAllByRole("checkbox")[1]);
		expect(screen.getAllByRole("checkbox")[1]).toBeDisabled();
		expect(mockGetNodeSource).not.toHaveBeenCalled();
	});

	it("says a server that left the list is no longer there", async () => {
		await renderRouter(APP_ROUTES, { initialUrl: DOC_URL });
		expect(await screen.findByText("This server is no longer in the list.")).toBeOnTheScreen();
	});
});
