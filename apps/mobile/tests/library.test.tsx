import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import { Uniwind } from "uniwind";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import type { ProbeResult } from "../src/servers/connection";
import { baseName, childPath, pathFromSegments, pathSegments } from "../src/library/paths";
import { libraryRows, type RootsState } from "../src/library/rows";
import { SERVERS_KEY, type KnownServer } from "../src/servers/store";
import { APP_ROUTES } from "./app-routes";
import { loadCompiledStylesheet, resolveTheme, unusable } from "./stylesheet/analyze.js";
import { classesInAppSource } from "./stylesheet/source-classes.js";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

const STUDIO = "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e";
const LAPTOP = "0d6f3b1a-8c2e-4f5d-a7b9-1e3c5a7b9d0f";
const STUDIO_URL = "https://studio.tail1.ts.net";
const LAPTOP_URL = "https://laptop.tail1.ts.net";

function info(id: string, name: string): ServerInfo {
	return {
		id,
		name,
		version: "0.7.0",
		permissions: "full",
		mermaidVersion: "10.9.8",
		treeSchemaVersion: 1,
		tailnetUrls: [],
	};
}

function known(id: string, name: string, url: string): KnownServer {
	return {
		id,
		name,
		version: "0.7.0",
		permissions: "full",
		treeSchemaVersion: 1,
		addedAt: "2026-11-27T12:00:00.000Z",
		addresses: [{ url, source: "manual" }],
	};
}

// What each origin answers to getServerInfo, and the folders each server has.
const mockProbeAnswers = new Map<string, ProbeResult>();
const mockRoots = new Map<string, Array<{ name: string; dir: string }>>();
const mockListings = new Map<string, unknown>();

jest.mock("../src/servers/probe", () => ({
	createProbe: () => async (origin: string) =>
		mockProbeAnswers.get(origin) ?? { kind: "failed", cause: "could not connect" },
}));

jest.mock("@mdxserve/client/api", () => ({
	createApiClient: (origin: string) => ({
		listRoots: {
			query: async () => {
				const roots = mockRoots.get(origin);
				if (!roots) throw new Error("Unreachable");
				return { roots };
			},
		},
		getFolderListing: {
			query: async ({ path }: { path: string }) => {
				const listing = mockListings.get(`${origin}${path}`);
				if (!listing) throw new Error(`Not found: ${path}`);
				return listing;
			},
		},
	}),
}));

async function seed(servers: KnownServer[]) {
	await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify({ servers }));
}

function library() {
	return within(screen.getByTestId("library-content"));
}

beforeEach(async () => {
	mockProbeAnswers.clear();
	mockRoots.clear();
	mockListings.clear();
	await AsyncStorage.clear();
});

afterEach(async () => {
	await act(() => Uniwind.setTheme("light"));
});

describe("libraryRows", () => {
	const studio = known(STUDIO, "Studio", STUDIO_URL);
	const laptop = known(LAPTOP, "Laptop", LAPTOP_URL);

	it("sorts roots by name, then by server name, and puts the servers without roots last", () => {
		const states: RootsState[] = [
			{
				kind: "ok",
				roots: [
					{ name: "notes", dir: "/s/notes" },
					{ name: "Docs", dir: "/s/docs" },
				],
			},
			{ kind: "ok", roots: [{ name: "notes", dir: "/l/notes" }] },
		];
		const rows = libraryRows([studio, laptop], states);
		expect(
			rows.map((row) => (row.kind === "root" ? `${row.root.name}@${row.server.name}` : row.kind)),
		).toEqual(["Docs@Studio", "notes@Laptop", "notes@Studio"]);
	});

	it("gives an unreachable or loading server one row each, by server name", () => {
		const rows = libraryRows(
			[studio, laptop, known("c4e6a8b0-d2f4-4a6c-8e0b-2d4f6a8c0e1b", "Attic", "https://attic")],
			[{ kind: "failed", message: "Unreachable" }, { kind: "ok", roots: [] }, { kind: "loading" }],
		);
		expect(rows.map((row) => `${row.kind}:${row.server.name}`)).toEqual([
			"loading:Attic",
			"unreachable:Studio",
		]);
	});

	it("sorts servers by the reader's name for them", () => {
		const rows = libraryRows(
			[laptop, { ...studio, label: "Desk" }],
			[
				{ kind: "ok", roots: [{ name: "notes", dir: "/l/notes" }] },
				{ kind: "ok", roots: [{ name: "notes", dir: "/s/notes" }] },
			],
		);
		expect(rows.map((row) => row.server.id)).toEqual([STUDIO, LAPTOP]);
	});
});

describe("folder paths in routes", () => {
	it.each([
		"/Users/me/notes",
		"/Volumes/External flash/docs",
		"/",
		"C:\\Users\\me\\notes",
		"D:\\",
		"\\\\nas\\share\\notes",
	])("round-trip %s through the [...path] segments", (dir) => {
		expect(pathFromSegments(pathSegments(dir))).toBe(dir);
	});

	it("split a Windows path on either separator", () => {
		expect(pathSegments("C:\\Users\\me\\notes")).toEqual(["C:", "Users", "me", "notes"]);
		expect(pathSegments("C:/Users/me")).toEqual(["C:", "Users", "me"]);
		expect(pathSegments("\\\\nas\\share")).toEqual(["\\\\nas", "share"]);
	});

	it("read a single segment or none as a POSIX path", () => {
		expect(pathFromSegments("notes")).toBe("/notes");
		expect(pathFromSegments(undefined)).toBe("/");
	});

	it("join a child with the folder's own separator, and name the last part", () => {
		expect(childPath("/Users/me/notes", "plans")).toBe("/Users/me/notes/plans");
		expect(childPath("/", "notes")).toBe("/notes");
		expect(childPath("C:\\Users\\me", "notes")).toBe("C:\\Users\\me\\notes");
		expect(childPath("D:\\", "notes")).toBe("D:\\notes");
		expect(baseName("C:\\Users\\me\\q4.mdx")).toBe("q4.mdx");
		expect(baseName("/Users/me/notes")).toBe("notes");
		expect(baseName("/")).toBe("/");
	});
});

const sheet = loadCompiledStylesheet();

describe("the Library's classes", () => {
	it.each(["light", "dark"])(
		"are all in the compiled stylesheet with usable values (%s)",
		(theme) => {
			const { classes } = resolveTheme(sheet, theme);
			const names = [
				...classesInAppSource("src/library/LibraryRowView.tsx"),
				...classesInAppSource("src/library/FolderEntryRow.tsx"),
				...classesInAppSource("app/(tabs)/settings/index.tsx"),
			];
			expect(names.length).toBeGreaterThan(8);
			expect(names.filter((name) => !(name in classes))).toEqual([]);
			const problems = names.flatMap((name) =>
				Object.entries(classes[name]).flatMap(([property, value]) => {
					const why = unusable(value);
					return why ? [`${name} ${property}: ${why}`] : [];
				}),
			);
			expect(problems).toEqual([]);
		},
	);
});

describe.each(["light", "dark"] as const)("the Library (%s)", (theme) => {
	beforeEach(async () => {
		await act(() => Uniwind.setTheme(theme));
	});

	it("lists every reachable server's folders with the server's name, and one row for a server it cannot reach (R1, R5)", async () => {
		await seed([
			known(STUDIO, "Studio", STUDIO_URL),
			known(LAPTOP, "Laptop", LAPTOP_URL),
			known("c4e6a8b0-d2f4-4a6c-8e0b-2d4f6a8c0e1b", "Attic", "https://attic.tail1.ts.net"),
		]);
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info(STUDIO, "Studio") });
		mockProbeAnswers.set(LAPTOP_URL, { kind: "ok", info: info(LAPTOP, "Laptop") });
		mockRoots.set(STUDIO_URL, [{ name: "notes", dir: "/Users/me/notes" }]);
		mockRoots.set(LAPTOP_URL, [{ name: "docs", dir: "/Users/me/docs" }]);
		await renderRouter(APP_ROUTES);

		expect(await library().findByLabelText("docs on Laptop")).toBeOnTheScreen();
		expect(await library().findByLabelText("notes on Studio")).toBeOnTheScreen();
		expect(await library().findByText("Unreachable")).toBeOnTheScreen();
		expect(library().getByText("Attic")).toBeOnTheScreen();
	});

	it("shows a server as unreachable when a refresh fails after its folders loaded", async () => {
		await seed([known(STUDIO, "Studio", STUDIO_URL)]);
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info(STUDIO, "Studio") });
		mockRoots.set(STUDIO_URL, [{ name: "notes", dir: "/Users/me/notes" }]);
		await renderRouter(APP_ROUTES);
		expect(await library().findByLabelText("notes on Studio")).toBeOnTheScreen();

		mockRoots.delete(STUDIO_URL);
		const list = screen.getByTestId("library-content");
		await act(async () => list.props.refreshControl.props.onRefresh());
		expect(await library().findByText("Unreachable")).toBeOnTheScreen();
		expect(library().queryByLabelText("notes on Studio")).toBeNull();
	});

	it("lists a server's folders on a pull to refresh once it can be reached again", async () => {
		await seed([known(STUDIO, "Studio", STUDIO_URL)]);
		mockRoots.set(STUDIO_URL, [{ name: "notes", dir: "/Users/me/notes" }]);
		await renderRouter(APP_ROUTES);
		expect(await library().findByText("Unreachable")).toBeOnTheScreen();

		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info(STUDIO, "Studio") });
		const list = screen.getByTestId("library-content");
		await act(async () => list.props.refreshControl.props.onRefresh());
		expect(await library().findByLabelText("notes on Studio")).toBeOnTheScreen();
	});

	it("opens a folder, a subfolder, and a document's placeholder (R2)", async () => {
		await seed([known(STUDIO, "Studio", STUDIO_URL)]);
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info(STUDIO, "Studio") });
		mockRoots.set(STUDIO_URL, [{ name: "notes", dir: "/Users/me/notes" }]);
		mockListings.set(`${STUDIO_URL}/Users/me/notes`, {
			path: "/Users/me/notes",
			rootName: "notes",
			rootDir: "/Users/me/notes",
			entries: [
				{ name: "plans", isDir: true, isDoc: false },
				{ name: "photo.png", isDir: false, isDoc: false },
			],
		});
		mockListings.set(`${STUDIO_URL}/Users/me/notes/plans`, {
			path: "/Users/me/notes/plans",
			rootName: "notes",
			rootDir: "/Users/me/notes",
			entries: [{ name: "q4.mdx", isDir: false, isDoc: true, title: "Fourth quarter" }],
		});
		await renderRouter(APP_ROUTES);

		await fireEvent.press(await library().findByLabelText("notes on Studio"));
		expect(screen).toHavePathname("/s/5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e/browse/Users/me/notes");
		expect(await screen.findByText("photo.png")).toBeOnTheScreen();
		await fireEvent.press(screen.getByLabelText("Folder plans"));
		await fireEvent.press(await screen.findByLabelText("Document Fourth quarter"));
		expect(screen).toHavePathname(
			"/s/5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e/doc/Users/me/notes/plans/q4.mdx",
		);
		expect(await screen.findByText("Reading documents arrives next")).toBeOnTheScreen();
		expect(screen.getByText("/Users/me/notes/plans/q4.mdx")).toBeOnTheScreen();
	});

	it("browses a Windows server's folders by their own paths", async () => {
		await seed([known(STUDIO, "Studio", STUDIO_URL)]);
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info(STUDIO, "Studio") });
		mockRoots.set(STUDIO_URL, [{ name: "notes", dir: "C:\\Users\\me\\notes" }]);
		mockListings.set(`${STUDIO_URL}C:\\Users\\me\\notes`, {
			path: "C:\\Users\\me\\notes",
			rootName: "notes",
			rootDir: "C:\\Users\\me\\notes",
			entries: [{ name: "plans", isDir: true, isDoc: false }],
		});
		mockListings.set(`${STUDIO_URL}C:\\Users\\me\\notes\\plans`, {
			path: "C:\\Users\\me\\notes\\plans",
			rootName: "notes",
			rootDir: "C:\\Users\\me\\notes",
			entries: [{ name: "q4.mdx", isDir: false, isDoc: true }],
		});
		await renderRouter(APP_ROUTES);

		await fireEvent.press(await library().findByLabelText("notes on Studio"));
		await fireEvent.press(await screen.findByLabelText("Folder plans"));
		await fireEvent.press(await screen.findByLabelText("Document q4.mdx"));
		expect(await screen.findByText("C:\\Users\\me\\notes\\plans\\q4.mdx")).toBeOnTheScreen();
	});

	it("shows why a folder could not be listed", async () => {
		await seed([known(STUDIO, "Studio", STUDIO_URL)]);
		mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info(STUDIO, "Studio") });
		await renderRouter(APP_ROUTES, {
			initialUrl: "/s/5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e/browse/Users/me/gone",
		});
		expect(await screen.findByText("Not found: /Users/me/gone")).toBeOnTheScreen();
	});
});

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

function textOf(tree: unknown): string {
	if (typeof tree === "string") return tree;
	if (tree === null || typeof tree !== "object") return "";
	if (Array.isArray(tree)) return tree.map(textOf).join("");
	return textOf((tree as HostElement).children ?? []);
}

function hasTestId(tree: unknown, testID: string): boolean {
	return allHosts(tree, "RCTScrollView").some((element) => element.props.testID === testID);
}

const FOLDER_URL = `/s/${STUDIO}/browse/Users/me/notes`;

async function openNotes(entries: unknown[]) {
	await seed([known(STUDIO, "Studio", STUDIO_URL)]);
	mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info(STUDIO, "Studio") });
	mockRoots.set(STUDIO_URL, [{ name: "notes", dir: "/Users/me/notes" }]);
	mockListings.set(`${STUDIO_URL}/Users/me/notes`, {
		path: "/Users/me/notes",
		rootName: "notes",
		rootDir: "/Users/me/notes",
		entries,
	});
}

describe("a folder inside the Library tab", () => {
	it("keeps the native tab items, and opens inside the Library tab", async () => {
		await openNotes([]);
		await renderRouter(APP_ROUTES, { initialUrl: FOLDER_URL });
		expect(await screen.findByText("This folder is empty.")).toBeOnTheScreen();
		const tabs = allHosts(screen.toJSON(), "RNSTabsScreenIOS");
		expect(tabs.map((tab) => tab.props.title)).toEqual([
			"Library",
			"Search",
			"Servers",
			"Settings",
		]);
		expect(hasTestId(tabs[0], "folder-content")).toBe(true);
	});

	it("shows the same leading wordmark header on the Library and on a folder, with the folder as the page's heading", async () => {
		await openNotes([]);
		await renderRouter(APP_ROUTES);
		await fireEvent.press(await library().findByLabelText("notes on Studio"));
		expect(await screen.findByText("This folder is empty.")).toBeOnTheScreen();
		const libraryTab = allHosts(screen.toJSON(), "RNSTabsScreenIOS")[0];
		const headers = allHosts(libraryTab, "RNSScreenStackHeaderConfig");
		expect(headers.map((header) => header.props.title)).toEqual(["Library", "notes"]);
		for (const header of headers) {
			const [title] = allHosts(header, "RNSScreenStackHeaderSubview");
			expect(title.props.type).toBe("left");
			expect(textOf(title)).toBe("mdxserve");
		}
		// A back item with no title: `backButtonDisplayMode` on iOS 14 and later, which the test
		// renderer does not report, `backTitleVisible` before it.
		const back = headers[1].props;
		expect(back.backButtonDisplayMode === "minimal" || back.backTitleVisible === false).toBe(true);
		expect(screen.getByRole("heading", { name: "notes" })).toBeOnTheScreen();
	});

	it("sorts by name or by last modified from a native menu, and keeps the choice on the device", async () => {
		await openNotes([
			{ name: "alpha.md", isDir: false, isDoc: true, mtime: 100 },
			{ name: "zulu.md", isDir: false, isDoc: true, mtime: 900 },
			{ name: "drafts", isDir: true, isDoc: false, mtime: 50 },
		]);
		await renderRouter(APP_ROUTES, { initialUrl: FOLDER_URL });
		await screen.findByLabelText("Document alpha.md");
		const order = () =>
			screen.getAllByLabelText(/^(Document|Folder) /).map((row) => row.props.accessibilityLabel);
		expect(order()).toEqual(["Folder drafts", "Document alpha.md", "Document zulu.md"]);

		const header = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
			(candidate) => candidate.props.title === "notes",
		)!;
		const menu = header.props.headerRightBarButtonItems.find(
			(item: { type: string }) => item.type === "menu",
		);
		expect(menu).toMatchObject({
			accessibilityLabel: "Sort",
			icon: { name: "arrow.up.arrow.down" },
		});
		expect(
			menu.menu.items.map((item: { title: string; state: string }) => [item.title, item.state]),
		).toEqual([
			["Name", "on"],
			["Last modified", "off"],
		]);
		const modified = menu.menu.items.find(
			(item: { title: string }) => item.title === "Last modified",
		);
		await act(async () => {
			header.props.onPressHeaderBarButtonMenuItem({ nativeEvent: { menuId: modified.menuId } });
		});
		expect(order()).toEqual(["Folder drafts", "Document zulu.md", "Document alpha.md"]);
		expect(await AsyncStorage.getItem("mdxserve.listing.sort")).toBe("modified");
	});

	it("reads the stored order when the app starts", async () => {
		await openNotes([
			{ name: "a.md", isDir: false, isDoc: true, mtime: 100 },
			{ name: "b.md", isDir: false, isDoc: true, mtime: 900 },
		]);
		await AsyncStorage.setItem("mdxserve.listing.sort", "modified");
		await renderRouter(APP_ROUTES, { initialUrl: FOLDER_URL });
		await screen.findByLabelText("Document a.md");
		await waitFor(() =>
			expect(
				screen.getAllByLabelText(/^Document /).map((row) => row.props.accessibilityLabel),
			).toEqual(["Document b.md", "Document a.md"]),
		);
	});
});

describe("the header: the wordmark leading, the server trailing", () => {
	it("leads every tab's header with the wordmark and draws no title beside it", async () => {
		await openNotes([]);
		await renderRouter(APP_ROUTES, { initialUrl: FOLDER_URL });
		await screen.findByText("This folder is empty.");
		const headers = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").filter(
			(header) => header.props.hidden !== true,
		);
		expect(headers.map((header) => header.props.title)).toEqual([
			"notes",
			"Search",
			"Servers",
			"Settings",
		]);
		for (const header of headers) {
			const subviews = allHosts(header, "RNSScreenStackHeaderSubview");
			const left = subviews.filter((subview) => subview.props.type === "left");
			const center = subviews.filter((subview) => subview.props.type === "center");
			expect(left).toHaveLength(1);
			expect(textOf(left[0])).toBe("mdxserve");
			// No glass bubble behind the wordmark (iOS 26 and later).
			expect(left[0].props.hidesSharedBackground).toBe(true);
			// The centre holds an empty view, so iOS does not draw the title beside the wordmark.
			expect(center).toHaveLength(1);
			expect(textOf(center[0])).toBe("");
		}
		// The folder, pushed in the Library stack, keeps its back item beside the wordmark.
		expect(headers[0].props.hideBackButton).toBe(false);
	});

	it("ends a folder's header with its server's name, after the Sort item, and shows only the path under the heading", async () => {
		await openNotes([]);
		await renderRouter(APP_ROUTES, { initialUrl: FOLDER_URL });
		const path = await screen.findByTestId("folder-path");
		expect(path.props.children).toBe("/Users/me/notes");
		expect(path.props.numberOfLines).toBe(1);
		expect(path.props.ellipsizeMode).toBe("head");
		const header = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
			(candidate) => candidate.props.title === "notes",
		)!;
		const right = allHosts(header, "RNSScreenStackHeaderSubview").filter(
			(subview) => subview.props.type === "right",
		);
		expect(right.map(textOf)).toEqual(["Studio"]);
		expect(right[0].props.hidesSharedBackground).toBe(true);
		// The Sort menu stays a native bar item, which iOS may move beside a folded display.
		expect(
			header.props.headerRightBarButtonItems.map((item: { type: string }) => item.type),
		).toEqual(["menu"]);
		const content = within(screen.getByTestId("folder-content"));
		expect(content.queryByText("Studio")).toBeNull();
	});

	it("names the server under each Library folder, as before", async () => {
		await openNotes([]);
		await renderRouter(APP_ROUTES);
		const row = await library().findByLabelText("notes on Studio");
		expect(within(row).getByText("notes")).toBeOnTheScreen();
		expect(within(row).getByText("Studio")).toBeOnTheScreen();
	});
});

/**
 * Make the next write of the sort order go through `fail` instead of storage. Writes of other
 * keys (the server list records each server it reaches) still reach storage.
 */
function interceptNextSortWrite(fail: () => Promise<void>): () => void {
	const setItem = jest.mocked(AsyncStorage.setItem);
	const original = setItem.getMockImplementation()!;
	let intercepted = false;
	setItem.mockImplementation((key: string, value: string) => {
		if (key === "mdxserve.listing.sort" && !intercepted) {
			intercepted = true;
			return fail();
		}
		return original(key, value);
	});
	return () => setItem.mockImplementation(original);
}

describe("saving the sort order", () => {
	it("keeps a newer choice when an earlier write fails, and says the earlier one was not saved", async () => {
		await openNotes([
			{ name: "alpha.md", isDir: false, isDoc: true, mtime: 100 },
			{ name: "zulu.md", isDir: false, isDoc: true, mtime: 900 },
		]);
		await AsyncStorage.setItem("mdxserve.listing.sort", "modified");
		await renderRouter(APP_ROUTES, { initialUrl: FOLDER_URL });
		await screen.findByLabelText("Document alpha.md");
		await waitFor(() =>
			expect(screen.getAllByLabelText(/^Document /)[0].props.accessibilityLabel).toBe(
				"Document zulu.md",
			),
		);
		let failFirst: (error: Error) => void = () => {};
		const restore = interceptNextSortWrite(
			() => new Promise<void>((_resolve, reject) => (failFirst = reject)),
		);
		const choose = async (title: string) => {
			const header = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
				(candidate) => candidate.props.title === "notes",
			)!;
			const menu = header.props.headerRightBarButtonItems.find(
				(item: { type: string }) => item.type === "menu",
			);
			const item = menu.menu.items.find(
				(candidate: { title: string }) => candidate.title === title,
			);
			await act(async () => {
				header.props.onPressHeaderBarButtonMenuItem({ nativeEvent: { menuId: item.menuId } });
			});
		};
		await choose("Last modified");
		expect(screen.getByText("Saving the sort order…")).toBeOnTheScreen();
		await choose("Name");
		await act(async () => failFirst(new Error("disk full")));
		// Polled outside act: an async waitFor callback overlaps React's act scopes.
		for (
			let tries = 0;
			(await AsyncStorage.getItem("mdxserve.listing.sort")) !== "name";
			tries += 1
		) {
			if (tries > 100) throw new Error("the newer sort order was never saved");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		restore();
		expect(
			screen.getAllByLabelText(/^Document /).map((row) => row.props.accessibilityLabel),
		).toEqual(["Document alpha.md", "Document zulu.md"]);
	});

	it("goes back to the saved order and says why when the only write fails", async () => {
		await openNotes([
			{ name: "alpha.md", isDir: false, isDoc: true, mtime: 100 },
			{ name: "zulu.md", isDir: false, isDoc: true, mtime: 900 },
		]);
		await renderRouter(APP_ROUTES, { initialUrl: FOLDER_URL });
		await screen.findByLabelText("Document alpha.md");
		const restore = interceptNextSortWrite(() => Promise.reject(new Error("disk full")));
		const header = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
			(candidate) => candidate.props.title === "notes",
		)!;
		const menu = header.props.headerRightBarButtonItems.find(
			(item: { type: string }) => item.type === "menu",
		);
		await act(async () => {
			header.props.onPressHeaderBarButtonMenuItem({
				nativeEvent: { menuId: menu.menu.items[1].menuId },
			});
		});
		expect(
			await screen.findByText("The sort order was not saved on this device: Error: disk full"),
		).toBeOnTheScreen();
		expect(
			screen.getAllByLabelText(/^Document /).map((row) => row.props.accessibilityLabel),
		).toEqual(["Document alpha.md", "Document zulu.md"]);
		restore();
	});
});

describe("folder rows as the listing changes", () => {
	it("keeps each row's element across a re-sort, so rows move instead of being replaced", async () => {
		await openNotes([
			{ name: "alpha.md", isDir: false, isDoc: true, mtime: 100 },
			{ name: "zulu.md", isDir: false, isDoc: true, mtime: 900 },
		]);
		await renderRouter(APP_ROUTES, { initialUrl: FOLDER_URL });
		const alpha = await screen.findByLabelText("Document alpha.md");
		const zulu = screen.getByLabelText("Document zulu.md");
		const header = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
			(candidate) => candidate.props.title === "notes",
		)!;
		const menu = header.props.headerRightBarButtonItems.find(
			(item: { type: string }) => item.type === "menu",
		);
		await act(async () => {
			header.props.onPressHeaderBarButtonMenuItem({
				nativeEvent: { menuId: menu.menu.items[1].menuId },
			});
		});
		expect(
			screen.getAllByLabelText(/^Document /).map((row) => row.props.accessibilityLabel),
		).toEqual(["Document zulu.md", "Document alpha.md"]);
		expect(screen.getByLabelText("Document alpha.md")).toBe(alpha);
		expect(screen.getByLabelText("Document zulu.md")).toBe(zulu);
	});

	it("shows a refreshed listing in order, with the new row in and the removed row gone", async () => {
		await openNotes([
			{ name: "b.md", isDir: false, isDoc: true },
			{ name: "c.md", isDir: false, isDoc: true },
		]);
		await renderRouter(APP_ROUTES, { initialUrl: FOLDER_URL });
		const kept = await screen.findByLabelText("Document b.md");
		mockListings.set(`${STUDIO_URL}/Users/me/notes`, {
			path: "/Users/me/notes",
			rootName: "notes",
			rootDir: "/Users/me/notes",
			entries: [
				{ name: "b.md", isDir: false, isDoc: true },
				{ name: "a.md", isDir: false, isDoc: true },
				{ name: "drafts", isDir: true, isDoc: false },
			],
		});
		const list = screen.getByTestId("folder-content");
		await act(async () => list.props.refreshControl.props.onRefresh());
		await waitFor(() =>
			expect(
				screen.getAllByLabelText(/^(Document|Folder) /).map((row) => row.props.accessibilityLabel),
			).toEqual(["Folder drafts", "Document a.md", "Document b.md"]),
		);
		expect(screen.getByLabelText("Document b.md")).toBe(kept);
	});
});
