import type { ReactElement } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { ActionSheetIOS, Dimensions, StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import type { CodeNode } from "@mdxserve/client/document/tree-types";
import { chartDiagramMessage } from "@mdxserve/shared/mermaid-chart";
import { DiagramBlock } from "../src/diagram/DiagramBlock";
import { CONTROLS_HEIGHT } from "../src/diagram/DiagramControls";
import { ZOOM_STEP } from "../src/diagram/render-call";
import { DiagramSizes, DiagramSizesContext } from "../src/diagram/sizes";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { inlineDiagramSize } from "../src/diagram/size";
import { DIAGRAM_TIMEOUT_MS } from "../src/diagram/state";
import { appDocumentEnvironment } from "../src/document-environment";

// A Mermaid block in the app: the frame, the WebView stand-in (tests/setup/webview.js) and
// the messages the page would post, in both themes.

interface WebViewCalls {
	injected: string[];
	reloads: number;
}
const { webviewCalls } = jest.requireActual<{ webviewCalls: WebViewCalls[] }>(
	"react-native-webview",
);

const PAGE = "file:///diagram.html";
const FLOW_LR = "flowchart LR\n  A --> B";

function mermaid(value: string, id: string | null = "diagram-1", title: string | null = null) {
	return {
		type: "code",
		id,
		lang: "mermaid",
		title,
		showLineNumbers: false,
		highlightLines: [],
		value,
	} as CodeNode;
}

/** The requests an injected call hands the page, run as WebKit would. */
function requestsIn(
	code: string,
): { token: number; source: string; themeVariables: Record<string, string> }[] {
	const requests: never[] = [];
	// eslint-disable-next-line no-new-func -- running the injected call is the point
	new Function("window", code)({
		mdxserveDiagram: { render: (request: never) => requests.push(request) },
	});
	return requests;
}

function lastRequest(calls = webviewCalls.at(-1)) {
	const code = calls?.injected.at(-1);
	if (!code) throw new Error("nothing was injected");
	return requestsIn(code)[0]!;
}

/** The WebViews mounted, hidden from accessibility as they are on a device. */
function webviews() {
	return screen.getAllByTestId("diagram-webview", { includeHiddenElements: true });
}

async function post(message: unknown, webview = webviews()[0]!) {
	await fireEvent(webview, "message", { nativeEvent: { data: JSON.stringify(message) } });
}

/** The zoom calls injected into a WebView, as the page receives them. */
function zoomsIn(calls: WebViewCalls): unknown[] {
	const actions: unknown[] = [];
	for (const code of calls.injected)
		if (code.includes(".zoom("))
			// eslint-disable-next-line no-new-func -- running the injected call is the point
			new Function("window", code)({
				mdxserveDiagram: { zoom: (action: unknown) => actions.push(action) },
			});
	return actions;
}

/** The page draws the block's current request at 400 × 120. */
async function draw() {
	await post({ kind: "ready" });
	await post({
		kind: "rendered",
		token: lastRequest().token,
		width: 400,
		height: 120,
		title: null,
		description: null,
	});
}

async function setWindow(width: number, height = 900) {
	const size = { width, height, scale: 3, fontScale: 1 };
	await act(async () => Dimensions.set({ window: size, screen: size }));
}

function surface() {
	return screen.getByTestId("diagram-surface", { includeHiddenElements: true });
}

async function layOut(width: number) {
	await fireEvent(screen.getByTestId("diagram-body"), "layout", {
		nativeEvent: { layout: { width, height: 200, x: 0, y: 0 } },
	});
}

/** The presentation style of every modal in a rendered tree. */
function presentationStyles(tree: unknown): unknown[] {
	if (!tree || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap(presentationStyles);
	const node = tree as { props?: { presentationStyle?: unknown }; children?: unknown };
	const own = node.props?.presentationStyle === undefined ? [] : [node.props.presentationStyle];
	return [...own, ...presentationStyles(node.children)];
}

/** A folded iPhone Duo's safe area: the system's bar on the right. */
const METRICS = {
	frame: { x: 0, y: 0, width: 466, height: 900 },
	insets: { top: 47, left: 0, right: 40, bottom: 34 },
};

/**
 * Renders `ui` with a size cache of its own, so no test sees another's drawings, in a folded
 * Duo's safe area.
 */
function show(ui: ReactElement) {
	const sizes = new DiagramSizes();
	return render(ui, {
		wrapper: ({ children }) => (
			<SafeAreaProvider initialMetrics={METRICS}>
				<DiagramSizesContext value={sizes}>{children}</DiagramSizesContext>
			</SafeAreaProvider>
		),
	});
}

function bodyHeight(): unknown {
	return StyleSheet.flatten(screen.getByTestId("diagram-body").props.style as never)?.height;
}

beforeEach(async () => {
	webviewCalls.length = 0;
	await setWindow(466);
});

afterEach(() => {
	jest.useRealTimers();
});

afterAll(() => {
	Uniwind.setTheme("light");
});

describe.each(["light", "dark"] as const)("a Mermaid block in the %s theme", (theme) => {
	beforeEach(() => {
		Uniwind.setTheme(theme);
	});

	it("mounts one locked-down WebView and sends it the source and theme once it is ready", async () => {
		await show(<DiagramBlock node={mermaid("sequenceDiagram\n  A->>B: hi")} />);
		const webview = webviews()[0]!;
		expect(webview.props).toMatchObject({
			source: { uri: PAGE },
			originWhitelist: ["*"],
			allowingReadAccessToURL: PAGE,
			allowFileAccessFromFileURLs: false,
			allowUniversalAccessFromFileURLs: false,
			incognito: true,
			domStorageEnabled: false,
			sharedCookiesEnabled: false,
			thirdPartyCookiesEnabled: false,
			cacheEnabled: false,
			javaScriptEnabled: true,
			javaScriptCanOpenWindowsAutomatically: false,
			allowsLinkPreview: false,
			dataDetectorTypes: "none",
			allowsBackForwardNavigationGestures: false,
			textInteractionEnabled: false,
			scrollEnabled: false,
			accessibilityElementsHidden: true,
			importantForAccessibility: "no-hide-descendants",
		});
		expect(webview.props.onShouldStartLoadWithRequest({ url: PAGE })).toBe(true);
		expect(webview.props.onShouldStartLoadWithRequest({ url: "https://example.com/" })).toBe(false);
		expect(webviewCalls[0]!.injected).toEqual([]);

		await post({ kind: "ready" });
		const request = lastRequest();
		expect(request.source).toBe("sequenceDiagram\n  A->>B: hi");
		expect(request.themeVariables.primaryColor).toMatch(/^#|^rgb/);
		expect(Object.values(request.themeVariables)).not.toContain("transparent");
		expect(request.themeVariables.fontFamily).toContain("Manrope");
	});

	it("takes no touches inline, so a drag scrolls the document (M2)", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		expect(surface().props.pointerEvents).toBe("none");
	});

	it("sizes the frame to the drawing once it is drawn", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await layOut(430);
		expect(bodyHeight()).toBe(200);
		await post({ kind: "ready" });
		const { token } = lastRequest();
		await post({
			kind: "rendered",
			token,
			width: 1200,
			height: 300,
			title: null,
			description: null,
		});
		expect(bodyHeight()).toBe(
			inlineDiagramSize({
				natural: { width: 1200, height: 300 },
				available: 430,
				maxHeight: 630,
				minHeight: CONTROLS_HEIGHT,
			}).height,
		);
		expect(screen.queryByText("Rendering diagram…")).toBeNull();
	});

	it("shows Mermaid's error (M12)", async () => {
		await show(<DiagramBlock node={mermaid("flowchart LR\n  A -->")} />);
		await post({ kind: "ready" });
		await post({ kind: "error", token: lastRequest().token, message: "Parse error on line 2" });
		expect(screen.getByText("Mermaid could not render this diagram")).toBeTruthy();
		expect(screen.getByText("Parse error on line 2")).toBeTruthy();
		expect(screen.getByRole("alert")).toBeTruthy();
	});

	it("refuses a chart diagram with the web's message and no WebView (M11)", async () => {
		await show(<DiagramBlock node={mermaid('pie title Pets\n  "Dogs" : 3')} />);
		expect(screen.getByText(chartDiagramMessage("pie"))).toBeTruthy();
		expect(screen.getByText("Mermaid pie charts don't render here")).toBeTruthy();
		expect(screen.queryByTestId("diagram-webview", { includeHiddenElements: true })).toBeNull();
	});

	it("shows the source and Try again after 8 seconds without an answer (M4)", async () => {
		jest.useFakeTimers();
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await act(async () => {
			jest.advanceTimersByTime(DIAGRAM_TIMEOUT_MS - 1);
		});
		expect(screen.queryByText("Try again")).toBeNull();
		await act(async () => {
			jest.advanceTimersByTime(1);
		});
		expect(screen.getByText("The diagram could not be drawn.")).toBeTruthy();
		expect(screen.getByText(FLOW_LR)).toBeTruthy();
		await fireEvent.press(screen.getByText("Try again"));
		expect(screen.queryByText("Try again")).toBeNull();
		// A new WebView, on a fresh page.
		expect(webviewCalls).toHaveLength(2);
	});

	it("draws a left-to-right flowchart top-down in a narrow window only (M9)", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await post({ kind: "ready" });
		expect(lastRequest().source).toBe("flowchart TB\n  A --> B");
		await setWindow(951);
		expect(lastRequest().source).toBe(FLOW_LR);
	});

	it("keeps the drawing and its height while the same block redraws (M13, M14)", async () => {
		const view = await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await layOut(430);
		await post({ kind: "ready" });
		await post({
			kind: "rendered",
			token: lastRequest().token,
			width: 400,
			height: 320,
			title: null,
			description: null,
		});
		await view.rerender(<DiagramBlock node={mermaid("flowchart TB\n  A --> C")} />);
		expect(lastRequest().source).toBe("flowchart TB\n  A --> C");
		expect(bodyHeight()).toBe(320);
		expect(surface().props.className ?? "").not.toContain("opacity-0");
		expect(StyleSheet.flatten(surface().props.style as never)?.opacity).not.toBe(0);
	});

	it("never shows another block's drawing (M15)", async () => {
		const view = await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await post({ kind: "ready" });
		await post({
			kind: "rendered",
			token: lastRequest().token,
			width: 400,
			height: 120,
			title: null,
			description: null,
		});
		await view.rerender(<DiagramBlock node={mermaid("flowchart TB\n  X --> Y", "diagram-2")} />);
		expect(StyleSheet.flatten(surface().props.style as never)?.opacity).toBe(0);
		expect(screen.getByText("Rendering diagram…")).toBeTruthy();
	});

	it("ignores a stale or malformed answer (MS3)", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await post({ kind: "ready" });
		const { token } = lastRequest();
		await post({
			kind: "rendered",
			token: token + 5,
			width: 400,
			height: 120,
			title: null,
			description: null,
		});
		await post({ kind: "rendered", token, width: -1, height: 120, title: null, description: null });
		await fireEvent(webviews()[0]!, "message", { nativeEvent: { data: "{" } });
		expect(screen.getByText("Rendering diagram…")).toBeTruthy();
	});

	it("redraws in the new colours when the theme changes (M5)", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await post({ kind: "ready" });
		const before = lastRequest();
		await act(async () => Uniwind.setTheme(theme === "light" ? "dark" : "light"));
		const after = lastRequest();
		expect(after.token).toBe(before.token + 1);
		expect(after.themeVariables.primaryColor).not.toBe(before.themeVariables.primaryColor);
	});

	it("shows the source on the Code tab (M10, M17)", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		expect(screen.getAllByRole("tab")).toHaveLength(2);
		await fireEvent.press(screen.getByRole("tab", { name: "Code" }));
		expect(screen.getByText(FLOW_LR)).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Code", selected: true })).toBeTruthy();
	});

	it("is one accessible element named after the diagram (M16)", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR, "diagram-1", "Request flow")} />);
		expect(screen.getByLabelText("Diagram: Request flow")).toBeTruthy();
		await post({ kind: "ready" });
		await post({
			kind: "rendered",
			token: lastRequest().token,
			width: 400,
			height: 120,
			title: "Login",
			description: "The app asks the server",
		});
		const image = screen.getByLabelText("Diagram: Login. The app asks the server");
		expect(image.props.accessibilityRole).toBe("imagebutton");
	});

	it("opens a full screen view on a tap, with its own WebView, Source and Done (M3a)", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await fireEvent.press(screen.getByLabelText("Diagram: Mermaid diagram"));
		const mounted = webviews();
		expect(mounted).toHaveLength(2);
		expect(presentationStyles(screen.toJSON())).toEqual(["fullScreen"]);
		await post({ kind: "ready" }, mounted[1]);
		expect(lastRequest(webviewCalls[1]).source).toBe("flowchart TB\n  A --> B");
		await post(
			{
				kind: "rendered",
				token: lastRequest(webviewCalls[1]).token,
				width: 400,
				height: 120,
				title: null,
				description: null,
			},
			mounted[1],
		);
		await fireEvent.press(screen.getByText("Source"));
		expect(screen.getAllByText(FLOW_LR).length).toBeGreaterThan(0);
		await fireEvent.press(screen.getByText("Done"));
		expect(webviews()).toHaveLength(1);
	});

	it("stacks the web's controls on a drawn diagram: full screen, zoom in, reset, zoom out", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		expect(screen.queryByLabelText("Zoom in")).toBeNull();
		await draw();
		const labels = within(screen.getByTestId("diagram-controls"))
			.getAllByRole("button")
			.map((button) => button.props.accessibilityLabel);
		expect(labels).toEqual(["Expand diagram", "Zoom in", "Reset view", "Zoom out"]);
		// Compact like the web's stack, each still 44 pt wide to a finger and 44 pt tall at the
		// ends; between two buttons neither reaches into the other.
		const buttons = within(screen.getByTestId("diagram-controls")).getAllByRole("button");
		const slops = buttons.map(
			(button) =>
				button.props.hitSlop as { top: number; bottom: number; left: number; right: number },
		);
		for (const [position, button] of buttons.entries()) {
			const box = StyleSheet.flatten(button.props.style as never) as {
				width: number;
				height: number;
			};
			expect(box).toMatchObject({ width: 32, height: 32 });
			const slop = slops[position]!;
			expect(box.width + slop.left + slop.right).toBe(44);
			expect(slop.top).toBe(position === 0 ? 6 : 0);
			expect(slop.bottom).toBe(position === buttons.length - 1 ? 6 : 0);
		}
		// Fitted: nothing to reset or zoom out of.
		expect(screen.getByLabelText("Reset view")).toBeDisabled();
		expect(screen.getByLabelText("Zoom out")).toBeDisabled();
		await fireEvent.press(screen.getByLabelText("Expand diagram"));
		expect(webviews()).toHaveLength(2);
	});

	it("zooms in place from the controls, and pans only while zoomed", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await draw();
		const calls = webviewCalls[0]!;
		await fireEvent.press(screen.getByLabelText("Zoom in"));
		expect(zoomsIn(calls)).toEqual([{ kind: "zoom", factor: ZOOM_STEP }]);
		expect(surface().props.pointerEvents).toBe("none");

		await post({ kind: "zoom", scale: ZOOM_STEP });
		// Zoomed: a drag pans the drawing, and a tap no longer opens the full view.
		expect(surface().props.pointerEvents).toBe("auto");
		expect(screen.getByLabelText("Diagram: Mermaid diagram")).toBeDisabled();
		expect(screen.getByLabelText("Reset view")).toBeEnabled();

		await fireEvent.press(screen.getByLabelText("Zoom out"));
		await fireEvent.press(screen.getByLabelText("Reset view"));
		expect(zoomsIn(calls).slice(1)).toEqual([
			{ kind: "zoom", factor: 1 / ZOOM_STEP },
			{ kind: "reset" },
		]);
		await post({ kind: "zoom", scale: 1 });
		expect(surface().props.pointerEvents).toBe("none");

		await post({ kind: "zoom", scale: 10 });
		expect(screen.getByLabelText("Zoom in")).toBeDisabled();
	});

	it("drives the full view's own zoom from its controls", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await fireEvent.press(screen.getByLabelText("Diagram: Mermaid diagram"));
		const viewer = webviews()[1]!;
		await post({ kind: "ready" }, viewer);
		await post(
			{
				kind: "rendered",
				token: lastRequest(webviewCalls[1]).token,
				width: 400,
				height: 120,
				title: null,
				description: null,
			},
			viewer,
		);
		const controls = screen.getAllByTestId("diagram-controls");
		expect(controls).toHaveLength(1);
		expect(within(controls[0]!).queryByLabelText("Expand diagram")).toBeNull();
		await fireEvent.press(within(controls[0]!).getByLabelText("Zoom in"));
		expect(zoomsIn(webviewCalls[1]!)).toEqual([{ kind: "zoom", factor: ZOOM_STEP }]);
		expect(zoomsIn(webviewCalls[0]!)).toEqual([]);
	});

	it.each([
		[466, false],
		[951, true],
	])(
		"switches Diagram and Code with icons, named only when the window is wide (%d pt)",
		async (width, labelled) => {
			await setWindow(width);
			await show(
				<DiagramBlock node={mermaid("sequenceDiagram\n  A->>B: hi", "diagram-1", "Login")} />,
			);
			const tabs = screen.getAllByRole("tab");
			expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual(["Diagram", "Code"]);
			expect(screen.getByRole("tab", { name: "Diagram", selected: true })).toBeTruthy();
			expect(screen.queryByText("Diagram") !== null).toBe(labelled);
			expect(screen.queryByText("Code") !== null).toBe(labelled);
			for (const tab of tabs) {
				const slop = tab.props.hitSlop as {
					top: number;
					bottom: number;
					left: number;
					right: number;
				};
				const box = StyleSheet.flatten(tab.props.style as never) as {
					height: number;
					width?: number;
				};
				expect(box.height + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
				if (!labelled) expect((box.width ?? 0) + slop.left + slop.right).toBeGreaterThanOrEqual(44);
			}
			await fireEvent.press(screen.getByRole("tab", { name: "Code" }));
			expect(screen.getByRole("tab", { name: "Code", selected: true })).toBeTruthy();
			// No copy control on a diagram's frame.
			expect(screen.queryByLabelText("Copy")).toBeNull();
			// The title keeps the room the labels would take.
			expect(screen.getByText("Login")).toBeTruthy();
		},
	);

	it("lays a flowchart out as the reader chooses, for their view only", async () => {
		const sheet = jest
			.spyOn(ActionSheetIOS, "showActionSheetWithOptions")
			.mockImplementation((_options, choose) => choose(2));
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await post({ kind: "ready" });
		expect(lastRequest().source).toBe("flowchart TB\n  A --> B");
		await fireEvent.press(screen.getByLabelText("Layout: Top to bottom"));
		expect(sheet.mock.calls[0]![0].options).toEqual([
			"Top to bottom",
			"Bottom to top",
			"Left to right (as written)",
			"Right to left",
			"Cancel",
		]);
		expect(lastRequest().source).toBe(FLOW_LR);
		expect(screen.getByLabelText("Layout: Left to right")).toBeTruthy();
		// The source view and Copy keep the author's text.
		await fireEvent.press(screen.getByRole("tab", { name: "Code" }));
		expect(screen.getByText(FLOW_LR)).toBeTruthy();
		expect(screen.queryByLabelText("Layout: Left to right")).toBeNull();
		sheet.mockRestore();
	});

	it("shows no layout control for a diagram that is not a flowchart", async () => {
		await show(<DiagramBlock node={mermaid("sequenceDiagram\n  A->>B: hi")} />);
		expect(screen.queryByLabelText(/^Layout:/)).toBeNull();
	});

	it("reloads a WebView whose process ended and sends the request again", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		const webview = webviews()[0]!;
		await post({ kind: "ready" });
		const sent = webviewCalls[0]!.injected.length;
		await fireEvent(webview, "contentProcessDidTerminate", { nativeEvent: {} });
		expect(webviewCalls[0]!.reloads).toBe(1);
		await post({ kind: "ready" });
		expect(webviewCalls[0]!.injected).toHaveLength(sent + 1);
	});
});

describe("the document environment", () => {
	it("draws a mermaid block as a diagram and any other code as code (N1)", async () => {
		await render(<>{appDocumentEnvironment.renderCode(mermaid(FLOW_LR))}</>);
		expect(webviews()).toHaveLength(1);
		await render(
			<>{appDocumentEnvironment.renderCode({ ...mermaid("const a = 1;"), lang: "ts" })}</>,
		);
		expect(screen.queryByTestId("diagram-webview", { includeHiddenElements: true })).toBeNull();
		expect(screen.getByText("const a = 1;")).toBeTruthy();
	});
});
