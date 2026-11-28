import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, renderRouter, screen } from "expo-router/testing-library";
import { Appearance } from "react-native";
import { Uniwind } from "uniwind";
import { APP_ROUTES } from "./app-routes";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

/** A host element of the rendered tree, as `screen.toJSON()` returns them. */
interface HostElement {
	type: string;
	props: Record<string, unknown>;
	children: (HostElement | string)[] | null;
}

/** The first host element of `type` under `tree`: the root stack's screen for `RNSScreen`. */
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

/** The status bar style the root stack hands the tabs' native screen, which iOS asks. */
function statusBarStyle(): unknown {
	return findHost(screen.toJSON(), "RNSScreen")?.props.statusBarStyle;
}

/** The system's light or dark setting, and the app's theme following it or set over it. */
async function setThemes(system: "light" | "dark", app: "light" | "dark" | "system") {
	jest.spyOn(Appearance, "getColorScheme").mockReturnValue(system);
	await act(() => Uniwind.setTheme(app));
}

afterEach(async () => {
	jest.restoreAllMocks();
	await act(() => Uniwind.setTheme("light"));
});

describe("the status bar's colour", () => {
	it.each([
		["the light system theme", "light", "system", "dark"],
		["the dark system theme", "dark", "system", "light"],
		["the app's dark theme over a light system", "light", "dark", "light"],
		["the app's light theme over a dark system", "dark", "light", "dark"],
	] as const)(
		"follows %s: dark content on light, light content on dark",
		async (_, system, app, expected) => {
			await setThemes(system, app);
			await renderRouter(APP_ROUTES);
			expect(statusBarStyle()).toBe(expected);
		},
	);

	it("changes with the app's theme, never left to iOS's auto", async () => {
		await setThemes("light", "light");
		await renderRouter(APP_ROUTES);
		expect(statusBarStyle()).toBe("dark");
		await act(() => Uniwind.setTheme("dark"));
		expect(statusBarStyle()).toBe("light");
		await act(() => Uniwind.setTheme("light"));
		expect(statusBarStyle()).toBe("dark");
	});
});
