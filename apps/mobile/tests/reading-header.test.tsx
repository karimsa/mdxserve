import { describe, expect, it, jest } from "@jest/globals";
import { act, renderRouter, screen } from "expo-router/testing-library";
import { StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import { APP_ROUTES } from "./app-routes";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

const sheet = loadCompiledStylesheet();

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

interface Host {
	type: string;
	props: Record<string, any>;
	children: (Host | string)[] | null;
}

function headers(tree: unknown): Host[] {
	if (!tree || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap(headers);
	const host = tree as Host;
	return [
		...(host.type === "RNSScreenStackHeaderConfig" && host.props.title !== "(tabs)" ? [host] : []),
		...headers(host.children ?? []),
	];
}

function flat(host: Host): Record<string, unknown> {
	return StyleSheet.flatten(host.props.style) ?? {};
}

describe.each(["light", "dark"] as const)("the header bar (%s)", (theme) => {
	const page = resolveTheme(sheet, theme).variables["--surface-page"];

	it.each([
		["the Library", "/"],
		["a folder", "/s/5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e/browse/Users/me"],
		["Search", "/search"],
		["Servers", "/servers"],
		["Settings", "/settings"],
	])(
		"is translucent over %s: the page colour over a blur, drawn by the app",
		async (_, initialUrl) => {
			await act(() => Uniwind.setTheme(theme));
			await renderRouter(APP_ROUTES, { initialUrl });
			const found = headers(screen.toJSON());
			expect(found.length).toBeGreaterThan(0);
			for (const header of found) {
				expect(header.props.translucent).toBe(true);
				// The native bar has no colour or material: any colour makes react-native-screens draw
				// an opaque bar, so the app draws the background below it.
				expect(header.props.backgroundColor).toBe("transparent");
				expect(header.props.blurEffect ?? "none").toBe("none");
				// The wordmark still leads, with no bubble.
				const [left] = (header.children ?? []).filter(
					(child): child is Host => typeof child !== "string" && child.props.type === "left",
				);
				expect(left).toBeDefined();
			}
			const backgrounds = screen.getAllByTestId("header-background", {
				includeHiddenElements: true,
			});
			expect(backgrounds.length).toBeGreaterThan(0);
			for (const background of backgrounds) {
				// It never takes a touch meant for the bar's items.
				expect(background.props.pointerEvents).toBe("none");
				const [blur, tint] = background.children as unknown as Host[];
				const [nativeBlur] = blur.children as unknown as Host[];
				expect(nativeBlur.props).toMatchObject({ tint: theme, intensity: 40 });
				expect(flat(tint)).toMatchObject({ backgroundColor: page, opacity: 0.6 });
			}
			await act(() => Uniwind.setTheme("light"));
		},
	);
});
