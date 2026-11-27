import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import { router } from "expo-router";
import { Uniwind } from "uniwind";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import type { ProbeResult } from "../src/servers/connection";
import { searchSections, type SearchHit } from "../src/search/sections";
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
const ATTIC = "c4e6a8b0-d2f4-4a6c-8e0b-2d4f6a8c0e1b";
const STUDIO_URL = "https://studio.tail1.ts.net";
const LAPTOP_URL = "https://laptop.tail1.ts.net";
const ATTIC_URL = "https://attic.tail1.ts.net";

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

function hit(path: string, title: string, targetId: string | null = null): SearchHit {
	return {
		path,
		label: `notes${path.slice(path.lastIndexOf("/"))}`,
		title,
		excerpt: `About the deploy of ${title}`,
		terms: ["deploy"],
		targetId,
	};
}

const mockProbeAnswers = new Map<string, ProbeResult>();
const mockHits = new Map<string, SearchHit[]>();
const mockQueries: Array<{ origin: string; query: string }> = [];

jest.mock("../src/servers/probe", () => ({
	createProbe: () => async (origin: string) =>
		mockProbeAnswers.get(origin) ?? { kind: "failed", cause: "could not connect" },
}));

jest.mock("@mdxserve/client/api", () => ({
	createApiClient: (origin: string) => ({
		listRoots: { query: async () => ({ roots: [] }) },
		getDocument: {
			query: async ({ path }: { path: string }) => ({
				version: "v1",
				document: {
					schemaVersion: 1,
					metadata: { openGraph: [] },
					toc: [],
					children: [
						{
							type: "section",
							id: "rollout",
							level: 1,
							heading: [{ type: "text", value: `Read from ${path}` }],
							children: [],
						},
					],
				},
			}),
		},
		searchDocs: {
			query: async ({ query }: { query: string }) => {
				mockQueries.push({ origin, query });
				return { results: (mockHits.get(origin) ?? []).map((result) => ({ ...result, score: 1 })) };
			},
		},
	}),
}));

beforeEach(async () => {
	jest.mocked(AsyncStorage.setItem).mockClear();
	mockProbeAnswers.clear();
	mockHits.clear();
	mockQueries.length = 0;
	await AsyncStorage.clear();
});

afterEach(async () => {
	await act(() => Uniwind.setTheme("light"));
});

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

/** Type into the search field. */
async function typeQuery(text: string) {
	await fireEvent.changeText(screen.getByTestId("search-field"), text);
}

async function seedThree() {
	await AsyncStorage.setItem(
		SERVERS_KEY,
		JSON.stringify({
			servers: [
				known(STUDIO, "Studio", STUDIO_URL),
				known(ATTIC, "Attic", ATTIC_URL),
				known(LAPTOP, "Laptop", LAPTOP_URL),
			],
		}),
	);
	mockProbeAnswers.set(STUDIO_URL, { kind: "ok", info: info(STUDIO, "Studio") });
	mockProbeAnswers.set(LAPTOP_URL, { kind: "ok", info: info(LAPTOP, "Laptop") });
	mockHits.set(STUDIO_URL, [
		hit("/Users/me/notes/release.md", "Release plan", "rollout"),
		hit("/Users/me/notes/ops.md", "Ops"),
	]);
	mockHits.set(LAPTOP_URL, [hit("/home/me/docs/deploy.md", "Deploy guide")]);
}

function sectionTitles(): string[] {
	return within(screen.getByTestId("search-content"))
		.getAllByRole("heading")
		.map((heading) => heading.props.children);
}

describe("searchSections", () => {
	const studio = known(STUDIO, "Studio", STUDIO_URL);
	const laptop = known(LAPTOP, "Laptop", LAPTOP_URL);

	it("gives every server a section in the server list's order, keeping each server's ranking", () => {
		const sections = searchSections(
			[studio, laptop],
			[
				{ kind: "ok", results: [hit("/b.md", "B"), hit("/a.md", "A")] },
				{ kind: "ok", results: [] },
			],
		);
		expect(sections.map((section) => section.title)).toEqual(["Studio", "Laptop"]);
		expect(
			sections[0].data.map((row) => (row.kind === "result" ? row.hit.title : row.kind)),
		).toEqual(["B", "A"]);
		expect(sections[1].data.map((row) => row.kind)).toEqual(["empty"]);
	});

	it("says a server is still searching or could not be searched, in its own section", () => {
		const sections = searchSections(
			[studio, { ...laptop, label: "Desk" }],
			[{ kind: "loading" }, { kind: "failed", message: "Unreachable" }],
		);
		expect(sections.map((section) => section.title)).toEqual(["Studio", "Desk"]);
		expect(sections[0].data).toEqual([{ kind: "loading", key: `${STUDIO}:loading` }]);
		expect(sections[1].data).toEqual([
			{ kind: "unreachable", key: `${LAPTOP}:unreachable`, message: "Unreachable" },
		]);
	});

	it("keys results by server, path and section so they stay unique", () => {
		const sections = searchSections(
			[studio],
			[{ kind: "ok", results: [hit("/a.md", "A", "one"), hit("/a.md", "A", "two")] }],
		);
		const keys = sections[0].data.map((row) => row.key);
		expect(new Set(keys).size).toBe(2);
	});
});

const sheet = loadCompiledStylesheet();

describe("the search screen's classes", () => {
	it.each(["light", "dark"])(
		"are all in the compiled stylesheet with usable values (%s)",
		(theme) => {
			const { classes } = resolveTheme(sheet, theme);
			const names = [
				...classesInAppSource("src/search/SearchRowView.tsx"),
				...classesInAppSource("app/(tabs)/search/index.tsx"),
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

describe.each(["light", "dark"] as const)("searching every server (%s)", (theme) => {
	beforeEach(async () => {
		await act(() => Uniwind.setTheme(theme));
	});

	it("asks every server once the typing pauses, and shows one section per server in list order (S1, S2, S3)", async () => {
		await seedThree();
		await renderRouter(APP_ROUTES, { initialUrl: "/search" });
		expect(await screen.findByText("Search every server")).toBeOnTheScreen();
		await typeQuery("deploy");
		expect(await screen.findByLabelText("Deploy guide, notes/deploy.md")).toBeOnTheScreen();
		expect(sectionTitles()).toEqual(["Studio", "Attic", "Laptop"]);
		const content = within(screen.getByTestId("search-content"));
		expect(content.getByLabelText("Release plan, notes/release.md")).toBeOnTheScreen();
		expect(content.getByText("Unreachable")).toBeOnTheScreen();
		expect(mockQueries.map((asked) => asked.query)).toEqual(["deploy", "deploy"]);
	});
});

describe("opening a result", () => {
	it("opens the document inside the Search tab at the result's section, and back returns to the results", async () => {
		await seedThree();
		await renderRouter(APP_ROUTES, { initialUrl: "/search" });
		await typeQuery("deploy");
		const result = await screen.findByLabelText("Release plan, notes/release.md");
		await fireEvent.press(result);
		expect(screen).toHavePathname(`/search/s/${STUDIO}/doc/Users/me/notes/release.md`);
		expect(screen).toHaveSearchParams({
			serverId: STUDIO,
			path: ["Users", "me", "notes", "release.md"],
			node: "rollout",
		});
		expect(
			await screen.findByRole("heading", { name: "Read from /Users/me/notes/release.md" }),
		).toBeOnTheScreen();
		// It opened in the Search tab, not the Library's.
		const tabs = allHosts(screen.toJSON(), "RNSTabsScreenIOS");
		expect(tabs.map((tab) => tab.props.title)).toEqual([
			"Library",
			"Search",
			"Servers",
			"Settings",
		]);
		expect(
			allHosts(tabs[1], "RCTScrollView").some((view) => view.props.testID === "document-content"),
		).toBe(true);
		expect(
			allHosts(tabs[0], "RCTScrollView").some((view) => view.props.testID === "document-content"),
		).toBe(false);

		await act(async () => router.back());
		expect(screen).toHavePathname("/search");
		await waitFor(() =>
			expect(
				within(screen.getByTestId("search-content")).getByLabelText(
					"Release plan, notes/release.md",
				),
			).toBeOnTheScreen(),
		);
	});
});

/** The last value written for `key`, from the storage stand-in's record of writes. */
function lastWritten(key: string): string | undefined {
	const calls = jest.mocked(AsyncStorage.setItem).mock.calls.filter(([written]) => written === key);
	return calls.at(-1)?.[1];
}

function resultLabels(): string[] {
	return within(screen.getByTestId("search-content"))
		.queryAllByLabelText(/, notes\//)
		.map((row) => row.props.accessibilityLabel);
}

describe("clearing the search field", () => {
	it("empties the results at once when the field's clear control empties it, and they do not come back", async () => {
		await seedThree();
		await renderRouter(APP_ROUTES, { initialUrl: "/search" });
		await typeQuery("deploy");
		await screen.findByLabelText("Deploy guide, notes/deploy.md");
		// The field's clear control reports a text change to "".
		await fireEvent.changeText(screen.getByTestId("search-field"), "");
		expect(resultLabels()).toEqual([]);
		expect(screen.getByText("Search every server")).toBeOnTheScreen();
		// jest-expo runs on fake timers: move past the typing pause.
		await act(async () => {
			jest.advanceTimersByTime(400);
		});
		expect(resultLabels()).toEqual([]);
	});

	it("has no navigation bar search controller, so no Cancel control, and dismisses the keyboard without one", async () => {
		await seedThree();
		await renderRouter(APP_ROUTES, { initialUrl: "/search" });
		const field = await screen.findByTestId("search-field");
		expect(allHosts(screen.toJSON(), "RNSSearchBar")).toEqual([]);
		// The field's own clear control while there is text; Return is the keyboard's Search key and
		// leaves the field.
		expect(field.props.clearButtonMode).toBe("while-editing");
		expect(field.props.returnKeyType).toBe("search");
		expect(field.props.submitBehavior).toBe("blurAndSubmit");
		// Scrolling the results, or tapping anything that is not a control, puts the keyboard away.
		const list = screen.getByTestId("search-content");
		expect(list.props.keyboardDismissMode).toBe("on-drag");
		expect(list.props.keyboardShouldPersistTaps).toBe("handled");
	});

	it("searches at once on Return, without waiting for the typing pause", async () => {
		await seedThree();
		await renderRouter(APP_ROUTES, { initialUrl: "/search" });
		const field = screen.getByTestId("search-field");
		await fireEvent.changeText(field, "deploy");
		await fireEvent(field, "submitEditing", { nativeEvent: { text: "deploy" } });
		await waitFor(() => expect(mockQueries.length).toBe(2), { timeout: 200 });
	});
});

/** The filter's native menu, as the header hands it to UIKit. */
function filterMenu() {
	const header = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
		(candidate) => candidate.props.title === "Search",
	)!;
	const menu = header.props.headerRightBarButtonItems.find(
		(item: { type: string }) => item.type === "menu",
	);
	return { header, menu };
}

async function toggleServer(name: string) {
	const { header, menu } = filterMenu();
	const item = menu.menu.items.find((candidate: { title: string }) => candidate.title === name);
	await act(async () => {
		header.props.onPressHeaderBarButtonMenuItem({ nativeEvent: { menuId: item.menuId } });
	});
}

describe("choosing the servers to search", () => {
	it("lists every server with a check, all on by default, as a native bar item", async () => {
		await seedThree();
		await renderRouter(APP_ROUTES, { initialUrl: "/search" });
		await screen.findByText("Search every server");
		const { menu } = filterMenu();
		expect(menu).toMatchObject({
			accessibilityLabel: "Servers to search",
			icon: { type: "sfSymbol", name: "line.3.horizontal.decrease.circle" },
		});
		expect(
			menu.menu.items.map((item: { title: string; state: string }) => [item.title, item.state]),
		).toEqual([
			["Studio", "on"],
			["Attic", "on"],
			["Laptop", "on"],
		]);
	});

	it("leaves a turned-off server out of the search, shows the filter is on, and keeps the choice", async () => {
		await seedThree();
		await renderRouter(APP_ROUTES, { initialUrl: "/search" });
		await screen.findByText("Search every server");
		await toggleServer("Laptop");
		expect(filterMenu().menu).toMatchObject({
			accessibilityLabel: "Servers to search, filtered",
			icon: { name: "line.3.horizontal.decrease.circle.fill" },
		});
		await typeQuery("deploy");
		await screen.findByLabelText("Release plan, notes/release.md");
		expect(sectionTitles()).toEqual(["Studio", "Attic"]);
		expect(mockQueries.map((asked) => asked.origin)).toEqual([STUDIO_URL]);
		await waitFor(() =>
			expect(JSON.parse(lastWritten("mdxserve.search.excludedServers") ?? "null")).toEqual([
				LAPTOP,
			]),
		);
	});

	it("reads a stored choice, ignores servers no longer in the list, and searches a new server", async () => {
		await seedThree();
		await AsyncStorage.setItem(
			"mdxserve.search.excludedServers",
			JSON.stringify([LAPTOP, "7e1c0a9b-3d5f-4b7a-9c1e-2f4a6b8d0c1e"]),
		);
		await renderRouter(APP_ROUTES, { initialUrl: "/search" });
		await waitFor(() =>
			expect(filterMenu().menu.menu.items.map((item: { state: string }) => item.state)).toEqual([
				"on",
				"on",
				"off",
			]),
		);
		await toggleServer("Attic");
		// The removed server's id is gone; the ids follow the server list's order.
		await waitFor(() =>
			expect(JSON.parse(lastWritten("mdxserve.search.excludedServers") ?? "null")).toEqual([
				ATTIC,
				LAPTOP,
			]),
		);
	});

	it("says no server is selected when every one is turned off", async () => {
		await seedThree();
		await renderRouter(APP_ROUTES, { initialUrl: "/search" });
		await screen.findByText("Search every server");
		for (const name of ["Studio", "Attic", "Laptop"]) await toggleServer(name);
		await typeQuery("deploy");
		expect(await screen.findByText("No servers selected")).toBeOnTheScreen();
		expect(mockQueries).toEqual([]);
	});
});

describe("saving the server filter", () => {
	it("says the filter was not saved, next to the results, and goes back to the saved choice", async () => {
		await seedThree();
		await renderRouter(APP_ROUTES, { initialUrl: "/search" });
		await typeQuery("deploy");
		await screen.findByLabelText("Deploy guide, notes/deploy.md");
		const setItem = jest.mocked(AsyncStorage.setItem);
		const original = setItem.getMockImplementation()!;
		setItem.mockImplementation((key: string, value: string) =>
			key === "mdxserve.search.excludedServers"
				? Promise.reject(new Error("disk full"))
				: original(key, value),
		);
		await toggleServer("Laptop");
		expect(
			await screen.findByText("The server filter was not saved on this device: Error: disk full"),
		).toBeOnTheScreen();
		setItem.mockImplementation(original);
		// The results are still on screen, with Laptop back in them.
		await waitFor(() => expect(sectionTitles()).toEqual(["Studio", "Attic", "Laptop"]));
		expect(filterMenu().menu.menu.items.map((item: { state: string }) => item.state)).toEqual([
			"on",
			"on",
			"on",
		]);
	});
});
