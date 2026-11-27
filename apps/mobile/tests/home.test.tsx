import { describe, expect, it, jest } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";
import { Platform } from "react-native";
import { formatReactNativeVersion } from "../src/app-info";
import { APP_ROUTES } from "./app-routes";

// A device reads the app's name and version from the config `expo start` embeds; under jest
// there is none, so hand expo-constants the same config.
jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

type RenderedTree = ReturnType<typeof screen.toJSON>;

/** The titles of the native tabs, in order. */
function tabTitles(tree: RenderedTree): string[] {
	if (tree === null) return [];
	if (Array.isArray(tree)) return tree.flatMap(tabTitles);
	const own = tree.type === "RNSTabsScreenIOS" ? [String(tree.props.title)] : [];
	return [
		...own,
		...(tree.children ?? []).flatMap((child) =>
			typeof child === "string" ? [] : tabTitles(child),
		),
	];
}

/** The titles native-stack hands its header, read from the rendered host tree. */
function headerTitles(tree: RenderedTree): string[] {
	if (tree === null) {
		return [];
	}
	if (Array.isArray(tree)) {
		return tree.flatMap(headerTitles);
	}
	const own =
		tree.type === "RNSScreenStackHeaderConfig" &&
		tree.props.hidden !== true &&
		typeof tree.props.title === "string"
			? [tree.props.title]
			: [];
	return [
		...own,
		...(tree.children ?? []).flatMap((child) =>
			typeof child === "string" ? [] : headerTitles(child),
		),
	];
}

describe("the app's first screen", () => {
	it("is the Library tab, under the wordmark, beside the Search and Servers tabs", async () => {
		await renderRouter(APP_ROUTES);

		expect(screen).toHavePathname("/");
		expect(screen.getByTestId("library-content")).toBeOnTheScreen();
		// The navigation bars of the three tabs' stacks; the root stack hides its own.
		expect(headerTitles(screen.toJSON())).toEqual(["Library", "Search", "Servers"]);
		expect(screen.getByText("mdx")).toBeOnTheScreen();
		expect(tabTitles(screen.toJSON())).toEqual(["Library", "Search", "Servers"]);
	});
});

describe("Settings", () => {
	it("shows the app version and the React Native version", async () => {
		await renderRouter(APP_ROUTES, { initialUrl: "/settings" });

		expect(screen.getByText("mdxserve 0.1.0")).toBeOnTheScreen();
		expect(
			screen.getByText(
				`React Native ${formatReactNativeVersion(Platform.constants.reactNativeVersion)}`,
			),
		).toBeOnTheScreen();
		expect(screen.getByLabelText("Component gallery")).toBeOnTheScreen();
	});
});

describe("formatReactNativeVersion", () => {
	it("joins a release's numbers", () => {
		expect(formatReactNativeVersion({ major: 0, minor: 88, patch: 1, prerelease: null })).toBe(
			"0.88.1",
		);
	});

	it("appends a prerelease tag", () => {
		expect(formatReactNativeVersion({ major: 0, minor: 89, patch: 0, prerelease: "rc.1" })).toBe(
			"0.89.0-rc.1",
		);
	});
});
