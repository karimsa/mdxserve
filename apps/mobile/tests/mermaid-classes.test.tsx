import { afterAll, describe, expect, it } from "@jest/globals";
import { act, renderHook } from "@testing-library/react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import { MERMAID_TOKEN_FALLBACKS, mermaidThemeVariables } from "@mdxserve/shared/mermaid-theme";
import { useDiagramTheme } from "../src/diagram/theme";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadCompiledStylesheet, resolveTheme, unusable } from "./stylesheet/analyze.js";
import { classesInAppSource } from "./stylesheet/source-classes.js";

// Uniwind leaves out, without a warning, a class it cannot compile for a device; every class
// the diagram's components write, and every class useDiagramTheme reads a token through, must
// be in the app's compiled stylesheet with a value a device can use.

const sheet = loadCompiledStylesheet();

/** The thirteen classes src/diagram/theme.ts resolves Mermaid's tokens through. */
const THEME_CLASSES = [
	...readFileSync(path.join(__dirname, "../src/diagram/theme.ts"), "utf8").matchAll(
		/useTextColor\("([^"]+)"\)/g,
	),
].map((match) => match[1]!);

/** classesInAppSource, plus the quoted class lists in a `className={a ? "…" : "…"}`. */
function classesIn(file: string): string[] {
	const source = readFileSync(path.join(__dirname, "..", file), "utf8");
	const conditional = [...source.matchAll(/className=\{([^`}][^}]*)\}/g)].flatMap((match) =>
		[...match[1]!.matchAll(/"([^"]*)"/g)].flatMap((quoted) => quoted[1]!.split(/\s+/)),
	);
	return [...classesInAppSource(file), ...conditional].filter(Boolean);
}

describe("the diagram's classes", () => {
	it("read all thirteen colour tokens of Mermaid's theme", () => {
		expect(THEME_CLASSES).toHaveLength(13);
	});

	it.each(["light", "dark"])("are in the compiled stylesheet with usable values (%s)", (theme) => {
		const { classes } = resolveTheme(sheet, theme);
		const used = [
			...classesIn("src/diagram/DiagramBlock.tsx"),
			...classesIn("src/diagram/DiagramScreen.tsx"),
			...classesIn("src/diagram/DiagramNotice.tsx"),
			...classesIn("src/diagram/DiagramControls.tsx"),
			...classesIn("src/diagram/DiagramActions.tsx"),
			...classesIn("src/document/CodeFrame.tsx"),
			...THEME_CLASSES,
		];
		const problems = used.flatMap((className) => {
			const style = classes[className];
			if (!style) return [`${className}: not in the stylesheet`];
			return Object.entries(style).flatMap(([property, value]) => {
				const why = unusable(value);
				return why ? [`${className} ${property}: ${why}`] : [];
			});
		});
		expect(problems).toEqual([]);
	});
});

afterAll(() => {
	Uniwind.setTheme("light");
});

describe.each(["light", "dark"] as const)("Mermaid's theme in the %s theme", (theme) => {
	it("takes every colour from the design tokens, as the web client does (M5)", async () => {
		await act(async () => Uniwind.setTheme(theme));
		const { result } = await renderHook(() => useDiagramTheme());
		const { variables } = resolveTheme(sheet, theme);
		const expected = mermaidThemeVariables((token) =>
			token === "--font-core"
				? "Manrope, -apple-system, sans-serif"
				: String(variables[token] ?? MERMAID_TOKEN_FALLBACKS[token]),
		);
		expect(result.current).toEqual(expected);
		for (const token of Object.keys(MERMAID_TOKEN_FALLBACKS))
			if (token !== "--font-core") expect(variables[token]).toMatch(/^#[0-9a-f]{6}$/i);
	});
});
