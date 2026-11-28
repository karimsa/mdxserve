import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Dimensions, StyleSheet } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";
import { ZOOM_STEP } from "../src/diagram/render-call";
import { APP_ROUTES } from "./app-routes";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

const sheet = loadCompiledStylesheet();

/** The diagram's background in `theme`, as the stylesheet resolves the token. */
function canvas(theme: "light" | "dark"): unknown {
	return resolveTheme(sheet, theme).variables["--diagram-bg"];
}

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

/** Whether `tree` holds the element with `testID`. */
function holds(tree: unknown, testID: string): boolean {
	if (tree === null || typeof tree !== "object") return false;
	if (Array.isArray(tree)) return tree.some((child) => holds(child, testID));
	const element = tree as HostElement;
	return element.props?.testID === testID || holds(element.children ?? [], testID);
}

/**
 * What UIKit reports as the full view's own safe area: its provider is the one around the
 * diagram's area, and its insets count the bar only where the bar covers that area.
 */
async function setAreaInsets(insets: EdgeInsets) {
	const provider = allHosts(screen.toJSON(), "RNCSafeAreaProvider")
		.filter((candidate) => holds(candidate.children, "diagram-screen-body"))
		.at(-1);
	if (!provider) throw new Error("no safe area provider around the diagram");
	await act(async () => {
		provider.props.onInsetsChange({
			nativeEvent: { insets, frame: { x: 0, y: 0, width: 951, height: 669 } },
		});
	});
}

function bodyPadding() {
	const body = screen.getByTestId("diagram-screen-body", { includeHiddenElements: true });
	const style = StyleSheet.flatten(body.props.style as never) as Record<string, number>;
	return {
		top: style.paddingTop,
		right: style.paddingRight,
		bottom: style.paddingBottom,
		left: style.paddingLeft,
	};
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
	await fireEvent.press(screen.getAllByTestId("diagram-open")[0]!);
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
		// Plain SF Symbols: iOS moves only symbol items into a folded display's vertical bar.
		expect(items().map((entry) => [entry.accessibilityLabel, entry.icon?.name])).toEqual([
			["Zoom in", "plus"],
			["Reset view", "viewfinder"],
			["Zoom out", "minus"],
			["Layout: Top to bottom", "arrow.down"],
			["Done", "xmark"],
		]);
		// One capsule for the three zoom items; the layout and Done stand alone.
		expect(items().map((entry) => [entry.accessibilityLabel, entry.sharesBackground])).toEqual([
			["Zoom in", true],
			["Reset view", true],
			["Zoom out", true],
			["Layout: Top to bottom", false],
			["Done", false],
		]);

		// No source view any more, and no floating controls.
		expect(screen.queryByText(/Phone --> Tailnet --> Server/)).toBeNull();
		expect(screen.queryByLabelText("Zoom in")).toBeNull();
		// An opaque bar (iOS 27 minimises a translucent one, and a minimised bar draws its items
		// over the content instead of in the vertical bar), with no title text and the canvas's
		// colour; the diagram starts below it, left of the vertical bar.
		expect(header().props.translucent).toBeFalsy();
		expect(header().props.hideShadow).toBe(true);
		expect(header().props.backgroundColor).toBe(canvas(theme));
		expect(screen.queryByText("Left to right (top-down when folded)")).toBeNull();
		expect(screen.getByLabelText("Left to right (top-down when folded)")).toBeTruthy();
		// The area is padded by what covers it, as UIKit measures it for this view: here the bar's
		// band at the top and the vertical bar on the right.
		await setAreaInsets({ top: 60, right: 84, bottom: 21, left: 0 });
		expect(bodyPadding()).toEqual({ top: 60, right: 84, bottom: 21, left: 0 });
		expect(webviews()[viewer]!.props.scrollEnabled).toBe(false);
	});

	it("zooms from the bar, with each item off when it cannot act", async () => {
		const viewer = await openFullView(FOLDED);
		expect(item("Zoom in").disabled).toBeFalsy();
		expect(item("Reset view").disabled).toBe(true);
		// Below fitted is allowed, as on the web.
		expect(item("Zoom out").disabled).toBeFalsy();
		await act(async () => item("Zoom in").onPress());
		expect(injected(viewer).zooms).toEqual([{ kind: "zoom", factor: ZOOM_STEP }]);

		await post(webviews()[viewer], { kind: "zoom", scale: ZOOM_STEP, fitted: false });
		expect(item("Reset view").disabled).toBeFalsy();
		await act(async () => item("Zoom out").onPress());
		await act(async () => item("Reset view").onPress());
		expect(injected(viewer).zooms.slice(1)).toEqual([
			{ kind: "zoom", factor: 1 / ZOOM_STEP },
			{ kind: "reset" },
		]);
		await post(webviews()[viewer], { kind: "zoom", scale: 10, fitted: false });
		expect(item("Zoom in").disabled).toBe(true);
		await post(webviews()[viewer], { kind: "zoom", scale: 0.2, fitted: false });
		expect(item("Zoom out").disabled).toBe(true);
		// Moved but not zoomed: reset is on.
		await post(webviews()[viewer], { kind: "zoom", scale: 1, fitted: false });
		expect(item("Reset view").disabled).toBeFalsy();
		await post(webviews()[viewer], { kind: "zoom", scale: 1, fitted: true });
		expect(item("Reset view").disabled).toBe(true);
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

	it("keeps a tall diagram clear of the bar on an unfolded display, from the area's own insets", async () => {
		await openFullView({ top: 0, right: 84, bottom: 21, left: 0 }, 951);
		// Unfolded the items sit in a top bar that covers the area's top 164 pt: the diagram
		// starts below it (a header height worked out in JavaScript fell short of it).
		await setAreaInsets({ top: 164, right: 84, bottom: 21, left: 0 });
		expect(bodyPadding()).toEqual({ top: 164, right: 84, bottom: 21, left: 0 });
		// Where something else already keeps the area below the bar, no second gap is added.
		await setAreaInsets({ top: 0, right: 84, bottom: 21, left: 0 });
		expect(bodyPadding()).toEqual({ top: 0, right: 84, bottom: 21, left: 0 });
		// The WebView fills the padded area, where the page fits the whole drawing.
		const area = screen.getByTestId("diagram-screen-area", { includeHiddenElements: true });
		expect(StyleSheet.flatten(area.props.style as never)).toMatchObject({ flex: 1 });
	});

	it("goes back to the page on Done", async () => {
		await openFullView(FOLDED);
		await act(async () => item("Done").onPress());
		expect(screen).toHavePathname("/gallery");
	});

	it("shows the same items across the top on an iPhone in portrait, the diagram below them", async () => {
		await openFullView(IPHONE, 393);
		await setAreaInsets({ top: 103, right: 0, bottom: 34, left: 0 });
		expect(bodyPadding()).toEqual({ top: 103, right: 0, bottom: 34, left: 0 });
		expect(items().map((entry) => entry.accessibilityLabel)).toEqual([
			"Zoom in",
			"Reset view",
			"Zoom out",
			"Layout: Top to bottom",
			"Done",
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
		await fireEvent.press(screen.getAllByTestId("diagram-open")[1]!);
		const labels = allHosts(screen.toJSON(), "RNSScreenStackHeaderConfig")
			.find((candidate) => candidate.props.title === "Diagram")!
			.props.headerRightBarButtonItems.map(
				(entry: { accessibilityLabel: string }) => entry.accessibilityLabel,
			);
		expect([...labels].reverse()).toEqual(["Zoom in", "Reset view", "Zoom out", "Done"]);
	});
});
