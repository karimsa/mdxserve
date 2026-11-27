import { describe, expect, it, jest } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";
import { StyleSheet } from "react-native";
import { APP_ROUTES } from "./app-routes";
import { loadCompiledStylesheet, resolveTheme, unusable } from "./stylesheet/analyze.js";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

// The stylesheet the device gets (tests/stylesheet/global-setup.js compiles it with Uniwind's
// Metro transformer), read the way Uniwind's native runtime reads it.
const sheet = loadCompiledStylesheet();

describe("the app's compiled stylesheet", () => {
	it("has light and dark themes", () => {
		expect(sheet.themes).toEqual(["light", "dark"]);
	});

	it.each(["light", "dark"])("has no variable that resolves through itself (%s)", (theme) => {
		expect(resolveTheme(sheet, theme).cycles).toEqual([]);
	});

	it.each(["light", "dark"])(
		"resolves every style the app's components use to a value a device can apply (%s)",
		(theme) => {
			const { classes } = resolveTheme(sheet, theme);
			const problems = Object.entries(classes).flatMap(([className, style]) =>
				Object.entries(style).flatMap(([property, value]) => {
					const why = unusable(value);
					return why ? [`${className} ${property}: ${why}`] : [];
				}),
			);
			expect(problems).toEqual([]);
			// The classes come from the sources Uniwind scans, so the shared components are in.
			expect(classes["bg-status-info-bg"]?.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
			expect(classes["font-sans"]?.fontFamily).toBe("Manrope");
		},
	);

	it.each(["light", "dark"])("resolves every design token (%s)", (theme) => {
		const { variables } = resolveTheme(sheet, theme);
		const problems = Object.entries(variables).flatMap(([name, value]) => {
			const why = unusable(value);
			return why && why !== "unset" ? [`${name}: ${why}`] : [];
		});
		expect(problems).toEqual([]);
	});
});

describe("screens with the compiled stylesheet", () => {
	it("render the gallery with the tokens' colours", async () => {
		await renderRouter(APP_ROUTES, { initialUrl: "/gallery" });
		// The sample document has a tip callout too; every one is drawn the same.
		const [title] = screen.getAllByText("Tip");
		const { variables } = resolveTheme(sheet, "light");
		expect(StyleSheet.flatten(title.props.style).color).toBe(variables["--text-accent"]);
		expect(screen.getByRole("tab", { name: "Overview", selected: true })).toBeOnTheScreen();
	});
});
