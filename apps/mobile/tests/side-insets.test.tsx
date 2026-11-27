import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { StyleSheet } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import RootLayout from "../app/_layout";
import Gallery from "../app/gallery";
import Home from "../app/index";
import Settings from "../app/settings";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

// A folded display with its vertical bar on the right: no top inset (the status bar is in
// the bar), the bar's width on the right. Unfolded, the bar goes and the top inset returns.
const FOLDED: EdgeInsets = { top: 0, right: 84, bottom: 21, left: 0 };
const UNFOLDED: EdgeInsets = { top: 59, right: 0, bottom: 34, left: 0 };

/** A host element of the rendered tree, as `screen.toJSON()` returns them. */
interface HostElement {
	type: string;
	props: Record<string, any>;
	children: (HostElement | string)[] | null;
}

/** The first host element of `type` under `tree` (an element, a list of them, or null). */
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

/** What the native safe area view reports when the window's insets change, as on a fold. */
async function setInsets(insets: EdgeInsets) {
	const provider = findHost(screen.toJSON(), "RNCSafeAreaProvider")!;
	await act(async () => {
		provider.props.onInsetsChange({
			nativeEvent: { insets, frame: { x: 0, y: 0, width: 393, height: 852 } },
		});
	});
}

function contentPadding(testID: string) {
	const style = StyleSheet.flatten(screen.getByTestId(testID).props.contentContainerStyle);
	return { left: style.paddingLeft, right: style.paddingRight };
}

const routes = { _layout: RootLayout, index: Home, settings: Settings, gallery: Gallery };

/** Presses the native bar item with `label`, as UIKit reports it. */
async function pressBarItem(label: string) {
	const header = findHost(screen.toJSON(), "RNSScreenStackHeaderConfig")!;
	const items = header.props.headerRightBarButtonItems as {
		buttonId: string;
		accessibilityLabel: string;
	}[];
	const item = items.find((candidate) => candidate.accessibilityLabel === label)!;
	await act(async () => {
		header.props.onPressHeaderBarButtonItem({ nativeEvent: { buttonId: item.buttonId } });
	});
}

describe("layout beside the system's vertical bar", () => {
	it("keeps the home screen's content inside the left and right insets", async () => {
		await renderRouter(routes);
		await setInsets(FOLDED);
		expect(contentPadding("home-content")).toEqual({ left: 16, right: 16 + 84 });
	});

	it("puts the wordmark in the header, and Settings, Gallery and Servers in the native bar, where iOS can move them", async () => {
		await renderRouter(routes);
		await setInsets(FOLDED);
		const header = findHost(screen.toJSON(), "RNSScreenStackHeaderConfig")!;
		// A native bar button with an icon, not a custom view: UIKit places it in the top bar or
		// in the vertical bar itself.
		expect(header.props.headerRightBarButtonItems).toEqual([
			// UIKit orders the right-hand items from the edge inwards.
			expect.objectContaining({
				type: "button",
				accessibilityLabel: "Settings",
				icon: { type: "sfSymbol", name: "gearshape" },
			}),
			expect.objectContaining({
				type: "button",
				accessibilityLabel: "Gallery",
				icon: { type: "sfSymbol", name: "square.grid.2x2" },
			}),
			expect.objectContaining({
				type: "button",
				accessibilityLabel: "Servers",
				icon: { type: "sfSymbol", name: "server.rack" },
			}),
		]);
		expect(findHost(header.children, "RNSScreenStackHeaderSubview")!.props.type).toBe("center");
		expect(screen.getByText("mdx")).toBeOnTheScreen();
		expect(screen.getByText("serve")).toBeOnTheScreen();
	});

	it("opens Settings from the bar item, inside the same insets", async () => {
		await renderRouter(routes);
		await setInsets(FOLDED);
		await pressBarItem("Settings");
		expect(screen).toHavePathname("/settings");
		expect(contentPadding("settings-content")).toEqual({ left: 16, right: 16 + 84 });
	});

	it("opens the gallery from its bar item, and keeps its state when the display unfolds", async () => {
		await renderRouter(routes);
		await setInsets(FOLDED);
		await pressBarItem("Gallery");
		expect(screen).toHavePathname("/gallery");
		expect(contentPadding("gallery-content")).toEqual({ left: 16, right: 16 + 84 });
		await fireEvent.press(screen.getByRole("tab", { name: "Example list" }));
		expect(screen.getByRole("tab", { name: "Example list", selected: true })).toBeOnTheScreen();

		await setInsets(UNFOLDED);
		expect(contentPadding("gallery-content")).toEqual({ left: 16, right: 16 });
		expect(screen.getByRole("tab", { name: "Example list", selected: true })).toBeOnTheScreen();
	});
});
