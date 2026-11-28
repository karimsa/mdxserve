import type { ReactElement } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ActionSheetIOS, Dimensions, StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import type { CodeNode } from "@mdxserve/client/document/tree-types";
import { chartDiagramMessage } from "@mdxserve/shared/mermaid-chart";
import { DIAGRAM_PADDING, DiagramBlock } from "../src/diagram/DiagramBlock";
import { DiagramSizes, DiagramSizesContext } from "../src/diagram/sizes";
import { DiagramViews, DiagramViewsContext } from "../src/diagram/diagram-views";
import { router } from "expo-router";
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

/** A folded iPhone Duo's safe area: the system's bar on the right. */
const METRICS = {
	frame: { x: 0, y: 0, width: 466, height: 900 },
	insets: { top: 47, left: 0, right: 40, bottom: 34 },
};

/**
 * Renders `ui` with a size cache of its own, so no test sees another's drawings, in a folded
 * Duo's safe area.
 */
function show(ui: ReactElement, views = new DiagramViews()) {
	const sizes = new DiagramSizes();
	return render(ui, {
		wrapper: ({ children }) => (
			<SafeAreaProvider initialMetrics={METRICS}>
				<DiagramViewsContext value={views}>
					<DiagramSizesContext value={sizes}>{children}</DiagramSizesContext>
				</DiagramViewsContext>
			</SafeAreaProvider>
		),
	});
}

function bodyHeight(): unknown {
	return StyleSheet.flatten(screen.getByTestId("diagram-body").props.style as never)?.height;
}

/** Where the block sends the reader for its full screen view. */
let push: ReturnType<typeof jest.spyOn>;

beforeEach(async () => {
	push = jest.spyOn(router, "push").mockImplementation(() => {});
	webviewCalls.length = 0;
	await setWindow(466);
});

afterEach(() => {
	jest.useRealTimers();
	push.mockRestore();
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

	it("is a still picture: a drag scrolls the document, a tap anywhere opens it (M2)", async () => {
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />);
		await draw();
		expect(surface().props.pointerEvents).toBe("none");
		// No zoom controls in the page: the full view has them.
		expect(screen.queryByLabelText("Zoom in")).toBeNull();
		expect(screen.queryByLabelText("Expand diagram")).toBeNull();
		// The tap target covers the whole frame body, padding included.
		const target = screen.getByTestId("diagram-open");
		expect(target.parent?.parent?.props.testID ?? target.parent?.props.testID).toBe("diagram-body");
		expect(StyleSheet.flatten(target.props.style as never)).toMatchObject({
			position: "absolute",
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
		});
		await fireEvent.press(target);
		expect(push).toHaveBeenCalledWith({ pathname: "/diagram", params: { view: "1" } });
	});

	it("sizes the frame to the drawing, inside its padding, once it is drawn", async () => {
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
		// The drawing fits the width left inside 16 pt of padding, and the padding is added back.
		expect(DIAGRAM_PADDING).toBe(16);
		expect(bodyHeight()).toBe(
			inlineDiagramSize({
				natural: { width: 1200, height: 300 },
				available: 430 - 32,
				maxHeight: 630 - 32,
				minHeight: 48,
			}).height + 32,
		);
		expect(bodyHeight()).toBe(Math.ceil(300 * (398 / 1200)) + 32);
		expect(
			StyleSheet.flatten(screen.getByTestId("diagram-body").props.style as never),
		).toMatchObject({ padding: 16 });
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
			width: 300,
			height: 320,
			title: null,
			description: null,
		});
		await view.rerender(<DiagramBlock node={mermaid("flowchart TB\n  A --> C")} />);
		expect(lastRequest().source).toBe("flowchart TB\n  A --> C");
		expect(bodyHeight()).toBe(320 + 2 * DIAGRAM_PADDING);
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
		expect(image.props.accessibilityHint).toBe("Opens full screen");
	});

	it("opens the full screen view on a tap, with what the block shows (M3a)", async () => {
		const views = new DiagramViews();
		await show(<DiagramBlock node={mermaid(FLOW_LR)} />, views);
		await fireEvent.press(screen.getByLabelText("Diagram: Mermaid diagram"));
		expect(push).toHaveBeenCalledWith({ pathname: "/diagram", params: { view: "1" } });
		expect(views.get("1")).toMatchObject({
			source: "flowchart TB\n  A --> B",
			authored: "LR",
			direction: "TB",
		});
		// A layout chosen in the full view reaches the block, and the view follows it.
		await act(async () => views.get("1")!.chooseDirection("LR"));
		expect(views.get("1")).toMatchObject({ source: FLOW_LR, direction: "LR" });
		await post({ kind: "ready" });
		expect(lastRequest().source).toBe(FLOW_LR);
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
