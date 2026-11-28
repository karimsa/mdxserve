import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Dimensions, StyleSheet } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";
import { ZOOM_STEP } from "../src/diagram/render-call";
import { APP_ROUTES } from "./app-routes";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

// A diagram's full screen view, opened from the gallery's first diagram (a flowchart written
// left to right) through the real router, with its controls as native bar items.

interface WebViewCalls {
	injected: string[];
}
const { webviewCalls } = jest.requireActual<{ webviewCalls: WebViewCalls[] }>(
	"react-native-webview",
);

/** A folded Duo: the vertical bar on the right. An iPhone in portrait has no side inset. */
const FOLDED: EdgeInsets = { top: 0, right: 84, bottom: 21, left: 0 };
const IPHONE: EdgeInsets = { top: 59, right: 0, bottom: 34, left: 0 };

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

async function setInsets(insets: EdgeInsets) {
	await act(async () => {
		for (const provider of allHosts(screen.toJSON(), "RNCSafeAreaProvider"))
			provider.props.onInsetsChange({
				nativeEvent: { insets, frame: { x: 0, y: 0, width: 393, height: 852 } },
			});
	});
}

/** The full view's header, as the native stack receives it. */
function header(): HostElement {
	const found = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig").find(
		(candidate) => candidate.props.title === "Left to right (top-down when folded)",
	);
	if (!found) throw new Error("no full view header");
	return found;
}

/** The bar's trailing items in the order the reader sees them (UIKit lists them from the edge in). */
function items(): Array<Record<string, any>> {
	return [...(header().props.headerRightBarButtonItems ?? [])].reverse();
}

function item(label: string): Record<string, any> {
	const found = items().find((candidate) => candidate.accessibilityLabel === label);
	if (!found) throw new Error(`no ${label} item`);
	return found;
}

function webviews() {
	return screen.getAllByTestId("diagram-webview", { includeHiddenElements: true });
}

async function post(webview: unknown, message: unknown) {
	await fireEvent(webview as never, "message", {
		nativeEvent: { data: JSON.stringify(message) },
	});
}

/** The requests and zoom actions injected into WebView `index`, as the page receives them. */
function injected(index: number) {
	const renders: Array<{ token: number; source: string }> = [];
	const zooms: unknown[] = [];
	for (const code of webviewCalls[index]?.injected ?? [])
		// eslint-disable-next-line no-new-func -- running the injected call is the point
		new Function("window", code)({
			mdxserveDiagram: {
				render: (request: { token: number; source: string }) => renders.push(request),
				zoom: (action: unknown) => zooms.push(action),
			},
		});
	return { renders, zooms };
}

async function draw(index: number) {
	const webview = webviews()[index]!;
	await post(webview, { kind: "ready" });
	const token = injected(index).renders.at(-1)!.token;
	await post(webview, {
		kind: "rendered",
		token,
		width: 400,
		height: 300,
		title: null,
		description: null,
	});
}

/** Opens the gallery, draws its first diagram and opens that diagram's full view. */
async function openFullView(insets: EdgeInsets, width = 466) {
	const size = { width, height: 852, scale: 3, fontScale: 1 };
	Dimensions.set({ window: size, screen: size });
	await renderRouter(APP_ROUTES, { initialUrl: "/gallery" });
	await setInsets(insets);
	await draw(0);
	await fireEvent.press(screen.getAllByLabelText("Expand diagram")[0]!);
	expect(screen).toHavePathname("/diagram");
	await setInsets(insets);
	const viewer = webviews().length - 1;
	await draw(viewer);
	return viewer;
}

beforeEach(() => {
	webviewCalls.length = 0;
});

afterAll(() => {
	Uniwind.setTheme("light");
});

describe.each(["light", "dark"] as const)("a diagram's full screen view (%s)", (theme) => {
	beforeEach(async () => {
		await act(async () => Uniwind.setTheme(theme));
	});

	it("puts every control in the bar as a native item with a symbol, beside a folded display", async () => {
		const viewer = await openFullView(FOLDED);
		expect(items().map((entry) => [entry.accessibilityLabel, entry.icon?.name])).toEqual([
			["Zoom in", "plus.magnifyingglass"],
			["Reset view", "arrow.down.right.and.arrow.up.left"],
			["Zoom out", "minus.magnifyingglass"],
			["Layout: Top to bottom", "arrow.down"],
			["Source", "chevron.left.forwardslash.chevron.right"],
			["Done", "xmark"],
		]);
		// No floating stack or title bar of its own: the diagram has the whole area, clear of
		// the vertical bar.
		// The one stack is the gallery's, under the full view, on the diagram drawn there.
		expect(
			screen.queryAllByTestId("diagram-controls", { includeHiddenElements: true }),
		).toHaveLength(1);
		const area = screen.getByTestId("diagram-screen-area", { includeHiddenElements: true });
		expect(StyleSheet.flatten(area.parent!.props.style as never)).toMatchObject({
			paddingRight: 84,
		});
		expect(webviews()[viewer]!.props.scrollEnabled).toBe(false);
	});

	it("zooms from the bar, with each item off when it cannot act", async () => {
		const viewer = await openFullView(FOLDED);
		expect(item("Zoom in").disabled).toBeFalsy();
		expect(item("Reset view").disabled).toBe(true);
		expect(item("Zoom out").disabled).toBe(true);
		await act(async () => item("Zoom in").onPress());
		expect(injected(viewer).zooms).toEqual([{ kind: "zoom", factor: ZOOM_STEP }]);

		await post(webviews()[viewer], { kind: "zoom", scale: ZOOM_STEP });
		expect(item("Reset view").disabled).toBeFalsy();
		await act(async () => item("Zoom out").onPress());
		await act(async () => item("Reset view").onPress());
		expect(injected(viewer).zooms.slice(1)).toEqual([
			{ kind: "zoom", factor: 1 / ZOOM_STEP },
			{ kind: "reset" },
		]);
		await post(webviews()[viewer], { kind: "zoom", scale: 10 });
		expect(item("Zoom in").disabled).toBe(true);
		// The inline diagram's own zoom is untouched.
		expect(injected(0).zooms).toEqual([]);
	});

	it("lays the flowchart out from a menu, in the full view and on the page", async () => {
		const viewer = await openFullView(FOLDED);
		const layout = item("Layout: Top to bottom");
		expect(layout.type).toBe("menu");
		expect(
			layout.menu.items.map((entry: { title: string; state: string }) => [
				entry.title,
				entry.state,
			]),
		).toEqual([
			["Top to bottom", "on"],
			["Bottom to top", "off"],
			["Left to right (as written)", "off"],
			["Right to left", "off"],
		]);
		const leftToRight = layout.menu.items[2];
		await act(async () => {
			header().props.onPressHeaderBarButtonMenuItem({
				nativeEvent: { menuId: leftToRight.menuId },
			});
		});
		expect(injected(viewer).renders.at(-1)!.source.startsWith("flowchart LR")).toBe(true);
		expect(item("Layout: Left to right")).toBeTruthy();
	});

	it("shows the source and back from the Source item", async () => {
		await openFullView(FOLDED);
		expect(item("Source").selected).toBeFalsy();
		await act(async () => item("Source").onPress());
		expect(item("Source").selected).toBe(true);
		expect(screen.getAllByText(/Phone --> Tailnet --> Server/).length).toBeGreaterThan(0);
		expect(item("Zoom in").disabled).toBe(true);
		await act(async () => item("Source").onPress());
		expect(item("Source").selected).toBeFalsy();
	});

	it("goes back to the page on Done", async () => {
		await openFullView(FOLDED);
		await act(async () => item("Done").onPress());
		expect(screen).toHavePathname("/gallery");
	});

	it("groups the layout and Source in a More menu on an iPhone in portrait", async () => {
		await openFullView(IPHONE, 393);
		expect(items().map((entry) => entry.accessibilityLabel)).toEqual([
			"Zoom in",
			"Reset view",
			"Zoom out",
			"More",
			"Done",
		]);
		const more = item("More");
		const titles = (entries: Array<{ title: string; items?: unknown[] }>): unknown[] =>
			entries.map((entry) =>
				entry.items ? [entry.title, titles(entry.items as never)] : entry.title,
			);
		expect(titles(more.menu.items)).toEqual([
			["Layout", ["Top to bottom", "Bottom to top", "Left to right (as written)", "Right to left"]],
			"Source",
		]);
	});
});

describe("a diagram's full screen view of another kind of diagram", () => {
	it("has no layout item", async () => {
		const size = { width: 466, height: 852, scale: 3, fontScale: 1 };
		Dimensions.set({ window: size, screen: size });
		await renderRouter(APP_ROUTES, { initialUrl: "/gallery" });
		await setInsets(FOLDED);
		await draw(1);
		await fireEvent.press(screen.getAllByLabelText("Expand diagram")[0]!);
		const labels = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig")
			.find((candidate) => candidate.props.title === "Diagram")!
			.props.headerRightBarButtonItems.map(
				(entry: { accessibilityLabel: string }) => entry.accessibilityLabel,
			);
		expect([...labels].reverse()).toEqual(["Zoom in", "Reset view", "Zoom out", "Source", "Done"]);
	});
});
