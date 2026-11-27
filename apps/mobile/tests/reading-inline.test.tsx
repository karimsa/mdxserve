import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import type { TreeNode } from "@mdxserve/client/document/tree-types";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { appDocumentEnvironment } from "../src/document-environment";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

const sheet = loadCompiledStylesheet();

const text = (value: string) => ({ type: "text", value });
const code = (value: string) => ({ type: "inlineCode", value });
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });

interface Host {
	type: string;
	props: { style?: unknown; testID?: string };
	children: (Host | string)[] | null;
}

function flat(host: { props: { style?: unknown } }): Record<string, unknown> {
	return StyleSheet.flatten(host.props.style as never) ?? {};
}

function hosts(tree: unknown): Host[] {
	if (!tree || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap(hosts);
	const host = tree as Host;
	return [host, ...hosts(host.children ?? [])];
}

function textOf(tree: unknown): string {
	if (typeof tree === "string") return tree;
	if (!tree || typeof tree !== "object") return "";
	if (Array.isArray(tree)) return tree.map(textOf).join("");
	return textOf((tree as Host).children ?? []);
}

async function draw(nodes: unknown[]) {
	return render(
		<DocumentEnvironmentProvider value={appDocumentEnvironment}>
			<NodeList nodes={nodes as TreeNode[]} />
		</DocumentEnvironmentProvider>,
	);
}

describe.each(["light", "dark"] as const)("inline text in the app (%s)", (theme) => {
	const { variables } = resolveTheme(sheet, theme);

	it("shows a newline in the Markdown source as a space, as the web does", async () => {
		Uniwind.setTheme(theme);
		const { toJSON } = await draw([
			paragraph(text("The design names two routes and\nsays a one-day   check\r\ndecides.")),
			{
				type: "section",
				id: "heading",
				level: 2,
				heading: [text("A heading\nover two lines")],
				children: [],
			},
			{ type: "blockquote", children: [paragraph(text("Quoted\ntext"))] },
			{
				type: "list",
				ordered: false,
				start: null,
				items: [{ checked: null, children: [paragraph(text("An item\nwrapped"))] }],
			},
		]);
		const all = textOf(toJSON());
		expect(all).toContain("The design names two routes and says a one-day check decides.");
		expect(all).toContain("A heading over two lines");
		expect(all).toContain("Quoted text");
		expect(all).toContain("An item wrapped");
		expect(all).not.toMatch(/\n/);
	});

	it("keeps a hard line break and a no-break space", async () => {
		Uniwind.setTheme(theme);
		const { toJSON } = await draw([
			paragraph(text("First line"), { type: "break" }, text("second line")),
		]);
		expect(textOf(toJSON())).toBe("First line\nsecond line");
	});

	it("draws a short code word as a rounded, padded chip on the text's baseline", async () => {
		Uniwind.setTheme(theme);
		await draw([
			paragraph(text("Today the app draws "), code("node.value"), text(" as one Text.")),
		]);
		const word = screen.getByText("node.value");
		expect(flat(word)).toMatchObject({ fontFamily: "JetBrains Mono", fontSize: 13 });
		expect(flat(word).lineHeight).toBeUndefined();
		expect(flat(word).backgroundColor).toBeUndefined();
		const chip = flat(word.parent as never);
		expect(chip).toMatchObject({
			backgroundColor: variables["--code-bg-inline"],
			borderRadius: 3,
		});
		expect(chip.paddingHorizontal ?? chip.paddingLeft).toBe(4);
		// Down by JetBrains Mono's descender (0.3 × 13 pt), so its text sits on the line's baseline.
		expect(chip.transform).toEqual([{ translateY: 4 }]);
	});

	it("draws long or spaced code as text that wraps, with no background slab", async () => {
		Uniwind.setTheme(theme);
		const path = "/Volumes/External flash/worktrees/mdxserve/.spike-highlighting/";
		await draw([paragraph(text("The experiments are in "), code(path), text("."))]);
		const run = screen.getByText(path);
		expect(flat(run)).toMatchObject({
			fontFamily: "JetBrains Mono",
			fontSize: 13,
			color: variables["--text-accent"],
		});
		expect(flat(run).backgroundColor).toBeUndefined();
		expect(flat(run).lineHeight).toBeUndefined();
	});

	it("gives a paragraph with code the same line height as one without", async () => {
		Uniwind.setTheme(theme);
		const { toJSON } = await draw([
			paragraph(text("Plain prose.")),
			paragraph(
				text("Prose with "),
				code("renderCode"),
				text(" and "),
				code("a long path/with spaces"),
			),
		]);
		const texts = hosts(toJSON()).filter((host) => host.type === "Text");
		const plain = texts.find((host) => textOf(host) === "Plain prose.");
		const withCode = texts.find((host) => textOf(host).startsWith("Prose with"));
		expect(flat(plain!).lineHeight).toBeCloseTo(28.38, 1);
		expect(flat(withCode!).lineHeight).toBe(flat(plain!).lineHeight);
		// No run inside it sets a line height of its own, which iOS would apply to the whole line.
		const inner = hosts(withCode!.children ?? []).filter((host) => host.type === "Text");
		expect(inner.length).toBeGreaterThan(0);
		for (const run of inner) expect(flat(run).lineHeight).toBeUndefined();
	});
});
