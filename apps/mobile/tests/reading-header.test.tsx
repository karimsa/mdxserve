import { describe, expect, it, jest } from "@jest/globals";
import { act, renderRouter, screen } from "expo-router/testing-library";
import { Uniwind } from "uniwind";
import { APP_ROUTES } from "./app-routes";

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

describe.each(["light", "dark"] as const)("the header bar (%s)", (theme) => {
	it.each([
		["the Library", "/"],
		["a folder", "/s/5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e/browse/Users/me"],
		["Search", "/search"],
		["Servers", "/servers"],
		["Settings", "/settings"],
	])("is translucent over %s: blurred, with no colour of its own", async (_, initialUrl) => {
		await act(() => Uniwind.setTheme(theme));
		await renderRouter(APP_ROUTES, { initialUrl });
		const found = headers(screen.toJSON());
		expect(found.length).toBeGreaterThan(0);
		for (const header of found) {
			expect(header.props).toMatchObject({
				translucent: true,
				blurEffect: theme === "dark" ? "systemThinMaterialDark" : "systemThinMaterialLight",
			});
			// Fully transparent: any other colour makes react-native-screens draw an opaque bar.
			expect(header.props.backgroundColor).toBe("transparent");
			// The wordmark still leads, with no bubble.
			const [left] = (header.children ?? []).filter(
				(child): child is Host => typeof child !== "string" && child.props.type === "left",
			);
			expect(left).toBeDefined();
		}
		await act(() => Uniwind.setTheme("light"));
	});
});
