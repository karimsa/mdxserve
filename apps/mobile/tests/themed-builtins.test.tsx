import { afterAll, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking, StyleSheet, Text } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import Card, { CardGrid } from "@mdxserve/ui/builtins/Card";
import FileTree from "@mdxserve/ui/builtins/FileTree";
import Kbd from "@mdxserve/ui/builtins/Kbd";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

// The shared builtins drawn with the app's real compiled stylesheet (tests/stylesheet), in both
// themes: each style a component gets must be a value a device can apply, and the colours
// must be the theme's tokens.

const sheet = loadCompiledStylesheet();

function styleOf(element: { props: { style?: unknown } }): Record<string, unknown> {
	return StyleSheet.flatten(element.props.style as never) ?? {};
}

/** Every style value under `element`, so an unresolved one (a `var()`, `undefined`) shows. */
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

afterAll(() => {
	Uniwind.setTheme("light");
});

describe.each(["light", "dark"] as const)("the shared builtins in the %s theme", (theme) => {
	const { variables } = resolveTheme(sheet, theme);

	it("draws a key cap in the card colours", async () => {
		Uniwind.setTheme(theme);
		const { toJSON } = await render(
			<Text>
				Press <Kbd>⌘</Kbd>
				<Kbd>K</Kbd>
			</Text>,
		);
		const label = screen.getByText("K");
		expect(styleOf(label).color).toBe(variables["--text-muted"]);
		expect(styleOf(label).fontFamily).toBe("JetBrains Mono");
		expect(unresolved(toJSON())).toEqual([]);
	});

	it("draws cards in a column, and a card with href opens it", async () => {
		Uniwind.setTheme(theme);
		const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
		const { toJSON } = await render(
			<CardGrid columns="2">
				<Card
					icon="rocket"
					title="Getting started"
					description="Point it at a folder."
					href="https://example.com/start"
					meta="2 min read"
					interactive={false}
				/>
				<Card title="Diagrams" description="Mermaid renders inline." interactive={true} />
			</CardGrid>,
		);
		expect(styleOf(screen.getByText("Getting started")).color).toBe(variables["--text-heading"]);
		expect(styleOf(screen.getByText("2 min read")).textTransform).toBe("uppercase");
		await fireEvent.press(screen.getByRole("link"));
		expect(openURL).toHaveBeenCalledWith("https://example.com/start");
		// Only a card with href is a control.
		expect(screen.queryAllByRole("link")).toHaveLength(1);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(unresolved(toJSON())).toEqual([]);
		openURL.mockRestore();
	});

	it("opens and closes a folder of a file tree and marks the active file", async () => {
		Uniwind.setTheme(theme);
		const { toJSON } = await render(
			<FileTree
				id="tree"
				activePath="deploy"
				nodes={[
					{
						name: "docs",
						children: [
							{ name: "install.mdx", path: "install" },
							{ name: "deploy.mdx", path: "deploy" },
						],
					},
					{ name: "package.json" },
				]}
			/>,
		);
		expect(styleOf(screen.getByText("deploy.mdx")).color).toBe(variables["--text-accent"]);
		expect(styleOf(screen.getByText("package.json")).color).toBe(variables["--text-muted"]);
		expect(unresolved(toJSON())).toEqual([]);

		const folder = screen.getByRole("button", { expanded: true });
		await fireEvent.press(folder);
		expect(screen.queryByText("install.mdx")).toBeNull();
		expect(screen.getByRole("button", { expanded: false })).toBeOnTheScreen();
		await fireEvent.press(folder);
		expect(screen.getByText("install.mdx")).toBeOnTheScreen();
	});
});
