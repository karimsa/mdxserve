import { afterAll, describe, expect, it } from "@jest/globals";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider, type EdgeInsets } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";
import "../src/global.css";
import Screenshot from "@mdxserve/ui/builtins/Screenshot";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

// The app's full-screen screenshot, drawn with the real compiled stylesheet in both themes:
// no Done button, the caption on a band at the bottom inside the safe area, and the ways
// that remain to close it.

const sheet = loadCompiledStylesheet();

// A folded display with its vertical bar on the right, as in side-insets.test.tsx.
const FOLDED: EdgeInsets = { top: 0, right: 84, bottom: 21, left: 0 };

interface HostElement {
	type: string;
	props: Record<string, any>;
	children: (HostElement | string)[] | null;
}

/** The first host element of `type` under `tree`. */
function findHost(tree: unknown, type: string): HostElement | null {
	if (tree === null || typeof tree !== "object") return null;
	if (Array.isArray(tree)) {
		for (const child of tree) {
			const hit = findHost(child, type);
			if (hit) return hit;
		}
		return null;
	}
	const element = tree as HostElement;
	if (element.type === type) return element;
	return findHost(element.children ?? [], type);
}

function styleOf(element: { props: { style?: unknown } }): Record<string, unknown> {
	return StyleSheet.flatten(element.props.style as never) ?? {};
}

async function renderOpen(props: { caption?: string; title?: string }) {
	await render(
		<SafeAreaProvider
			initialMetrics={{ frame: { x: 0, y: 0, width: 393, height: 852 }, insets: FOLDED }}
		>
			<Screenshot id="shot" src="https://example.com/reader.png" alt="The reader" {...props} />
		</SafeAreaProvider>,
	);
	await fireEvent.press(screen.getByRole("button", { name: "The reader. Opens full screen" }));
	expect(screen.getByTestId("screenshot-viewer-area")).toBeOnTheScreen();
}

afterAll(() => {
	Uniwind.setTheme("light");
});

describe.each(["light", "dark"] as const)("the full-screen screenshot in the %s theme", (theme) => {
	const { variables } = resolveTheme(sheet, theme);

	it("opens from a press on the image itself, with no Done button", async () => {
		Uniwind.setTheme(theme);
		await renderOpen({ caption: "The reader view." });
		expect(screen.queryByText("Done")).toBeNull();
		expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
	});

	it("puts a long caption below the image, wrapping, inside the bottom and side insets", async () => {
		Uniwind.setTheme(theme);
		const caption = "The reader view, with the table of contents pinned to the right. ".repeat(4);
		await renderOpen({ caption, title: "mdxserve" });
		const band = screen.getByTestId("screenshot-viewer-caption");
		// Below the zoomable area: the band is the sheet's last child, after it.
		const root = band.parent!;
		const children = root.children.filter((child) => typeof child !== "string");
		expect(children[children.length - 1]).toBe(band);
		expect(children.indexOf(screen.getByTestId("screenshot-viewer-area"))).toBeLessThan(
			children.indexOf(band),
		);
		expect(styleOf(band)).toMatchObject({
			paddingLeft: 16,
			paddingRight: 16 + 84,
			paddingBottom: 12 + 21,
			backgroundColor: variables["--surface-raised"],
		});
		const text = within(band).getByText(caption);
		expect(text.props.numberOfLines).toBeUndefined();
		expect(styleOf(text).color).toBe(variables["--text-body"]);
	});

	it("falls back to the window's title without a caption", async () => {
		Uniwind.setTheme(theme);
		await renderOpen({ title: "mdxserve — 01-markdown.md" });
		expect(screen.getByTestId("screenshot-viewer-caption")).toHaveTextContent(
			"mdxserve — 01-markdown.md",
		);
	});

	it("draws no band with neither a caption nor a title", async () => {
		Uniwind.setTheme(theme);
		await renderOpen({});
		expect(screen.queryByTestId("screenshot-viewer-caption")).toBeNull();
	});

	it("closes when the sheet is swiped down", async () => {
		Uniwind.setTheme(theme);
		await renderOpen({ caption: "The reader view." });
		const modal = findHost(screen.toJSON(), "Modal")!;
		expect(modal.props.presentationStyle).toBe("pageSheet");
		// iOS lets the sheet be dragged away and reports it as a request to close. A drag on the
		// image moves the sheet only once the image is at its top edge; at any zoom, one on the
		// grabber or the caption band always does.
		expect(modal.props.allowSwipeDismissal).toBe(true);
		await act(async () => modal.props.onRequestClose());
		expect(screen.queryByTestId("screenshot-viewer-area")).toBeNull();
	});

	it("closes from the grabber button and VoiceOver's escape gesture", async () => {
		Uniwind.setTheme(theme);
		await renderOpen({ caption: "The reader view." });
		const grabber = screen.getByRole("button", { name: "Close full screen" });
		// Outside the zoomable area, so a drag on it moves the sheet however far it is zoomed.
		expect(screen.getByTestId("screenshot-viewer-area")).not.toContainElement(grabber);
		await fireEvent.press(grabber);
		expect(screen.queryByTestId("screenshot-viewer-area")).toBeNull();

		await fireEvent.press(screen.getByRole("button", { name: "The reader. Opens full screen" }));
		const sheetRoot = screen.getByTestId("screenshot-viewer-area").parent!;
		expect(sheetRoot.props.accessibilityViewIsModal).toBe(true);
		await act(async () => sheetRoot.props.onAccessibilityEscape());
		expect(screen.queryByTestId("screenshot-viewer-area")).toBeNull();
	});
});
