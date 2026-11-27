import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking, StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { appDocumentEnvironment } from "../src/document-environment";
import { SAMPLE_DOCUMENT } from "../src/sample-document";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

// The shared node renderers in the app: the sample document drawn with the app's environment
// and the real compiled stylesheet, in both themes.

const sheet = loadCompiledStylesheet();

function styleOf(element: { props: { style?: unknown } }): Record<string, unknown> {
	return StyleSheet.flatten(element.props.style as never) ?? {};
}

function everyStyle(tree: unknown): Record<string, unknown>[] {
	if (!tree || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap(everyStyle);
	const node = tree as { props?: { style?: unknown }; children?: unknown };
	const own = node.props?.style ? [StyleSheet.flatten(node.props.style as never) ?? {}] : [];
	return [...own, ...everyStyle(node.children)];
}

function unresolved(tree: unknown): string[] {
	return everyStyle(tree).flatMap((style) =>
		Object.entries(style).flatMap(([property, value]) =>
			value === undefined || (typeof value === "string" && /var\(|calc\(/.test(value))
				? [`${property}: ${String(value)}`]
				: [],
		),
	);
}

async function renderSample() {
	return render(
		<DocumentEnvironmentProvider value={appDocumentEnvironment}>
			<NodeList nodes={SAMPLE_DOCUMENT} />
		</DocumentEnvironmentProvider>,
	);
}

describe.each(["light", "dark"] as const)("a document in the %s theme", (theme) => {
	const { variables } = resolveTheme(sheet, theme);

	it("draws headings, prose, lists, blocks and builtins with the theme's tokens", async () => {
		Uniwind.setTheme(theme);
		const { toJSON } = await renderSample();
		expect(screen.getByRole("heading", { name: "Markdown tour" })).toBeOnTheScreen();
		expect(screen.getByRole("heading", { name: "Lists" })).toBeOnTheScreen();
		const strong = screen.getByText("rendered natively");
		expect(styleOf(strong).color).toBe(variables["--text-heading"]);
		expect(screen.getByText("inline code")).toBeOnTheScreen();
		expect(screen.getByText("badge")).toBeOnTheScreen();
		expect(screen.getByText("1.")).toBeOnTheScreen();
		expect(screen.getByRole("checkbox", { checked: true })).toBeOnTheScreen();
		expect(screen.getByRole("checkbox", { checked: false })).toBeOnTheScreen();
		expect(screen.getByText("server.ts")).toBeOnTheScreen();
		expect(screen.getByText("Tip")).toBeOnTheScreen();
		expect(screen.getByText("Release")).toBeOnTheScreen();
		expect(screen.getByText("Unsupported component <Mystery>")).toBeOnTheScreen();
		expect(unresolved(toJSON())).toEqual([]);
	});

	it("opens a web link and switches tabs", async () => {
		Uniwind.setTheme(theme);
		const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
		await renderSample();
		await fireEvent.press(screen.getByText("link"));
		expect(openURL).toHaveBeenCalledWith("https://github.com/karimsa/mdxserve");
		expect(screen.getByRole("tab", { name: "macOS", selected: true })).toBeOnTheScreen();
		await fireEvent.press(screen.getByRole("tab", { name: "Linux" }));
		expect(screen.getByRole("tab", { name: "Linux", selected: true })).toBeOnTheScreen();
		openURL.mockRestore();
	});
});
