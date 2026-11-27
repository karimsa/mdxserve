import { describe, expect, it, jest } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";
import { Platform } from "react-native";
import { formatReactNativeVersion } from "../src/app-info";
import RootLayout from "../app/_layout";
import Home from "../app/index";

// A device reads the app's name and version from the config `expo start` embeds; under jest
// there is none, so hand expo-constants the same config.
jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

describe("home screen", () => {
	it("shows the app name, the app version and the React Native version", async () => {
		await renderRouter({ _layout: RootLayout, index: Home });

		expect(screen.getByRole("header", { name: "mdxserve" })).toBeOnTheScreen();
		expect(screen.getByText("Version 0.1.0")).toBeOnTheScreen();
		expect(
			screen.getByText(
				`React Native ${formatReactNativeVersion(Platform.constants.reactNativeVersion)}`,
			),
		).toBeOnTheScreen();
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
