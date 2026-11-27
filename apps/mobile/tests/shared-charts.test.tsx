import { afterEach, describe, expect, it } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { Uniwind } from "uniwind";
import Chart, { type ChartFrameProps } from "@mdxserve/ui/builtins/Chart";
import Sparkline from "@mdxserve/ui/builtins/Sparkline";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";
import "../src/global.css";

// Chart and Sparkline drawn by react-native-svg's native shapes with the app's real compiled
// stylesheet, in both themes. An SVG shape takes its colours as props, not classes, so each
// must reach the native shape as a concrete colour from the theme: a `var(--…)` the app cannot
// read would reach it as no colour at all.

const sheet = loadCompiledStylesheet();
const THEMES = ["light", "dark"] as const;
const HEX = /^#[0-9a-f]{6}$/;

const WEEK = [
	{ label: "Mon", p50: 42, p99: 180 },
	{ label: "Tue", p50: 38, p99: 165 },
	{ label: "Wed", p50: 51, p99: 210 },
];

type Node = (typeof screen)["container"];

function chart(overrides: ChartFrameProps = {}) {
	return (
		<Chart
			id="week"
			type="bar"
			orientation="vertical"
			data={WEEK}
			series={["p50", "p99"]}
			values={[]}
			height={220}
			filename="requests.json"
			legend
			{...overrides}
		/>
	);
}

/** Every native SVG shape of `kind` ("Rect", "Path", …) on the screen. */
function shapes(kind: string): Node[] {
	return screen.container.queryAll((node) => node.type === `RNSVG${kind}`);
}

/** A native shape's fill or stroke as `#rrggbb`, or null when it has none. */
function paint(value: unknown): string | null {
	if (!value || typeof value !== "object" || !("payload" in value)) return null;
	return `#${((value.payload as number) & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** The text a native SVG `<Text>` draws (its spans' content). */
function svgText(node: Node): string {
	return node
		.queryAll((child) => child.type === "RNSVGTSpan")
		.map((span) => String(span.props.content))
		.join("");
}

/** A tap on a native shape: the press handler react-native-svg's touch handling would call. */
async function tap(node: Node) {
	let fiber = node.unstable_fiber;
	while (fiber && typeof fiber.memoizedProps?.onPress !== "function") fiber = fiber.return;
	await act(() => fiber!.memoizedProps.onPress());
}

afterEach(async () => {
	await act(() => Uniwind.setTheme("light"));
});

describe("the chart classes in the compiled stylesheet", () => {
	it.each(THEMES)("resolve to concrete values (%s)", (theme) => {
		const { classes } = resolveTheme(sheet, theme);
		for (const name of ["1", "2", "3", "4", "5", "6", "grid", "axis", "label"]) {
			expect(classes[`text-chart-${name}`]?.color).toMatch(HEX);
		}
		for (const name of ["1", "2", "3", "4", "5", "6"]) {
			expect(classes[`bg-chart-${name}`]?.backgroundColor).toMatch(HEX);
		}
		for (const className of ["text-text-heading", "text-surface-card", "text-surface-hover"]) {
			expect(classes[className]?.color).toMatch(HEX);
		}
		expect(classes["font-mono"]?.fontFamily).toBe("JetBrains Mono");
		expect(classes["leading-[1.62]"]?.lineHeight).toEqual(expect.any(Number));
	});
});

describe.each(THEMES)("Chart in the %s theme", (theme) => {
	const { variables } = resolveTheme(sheet, theme);

	it("draws one bar per value in the series colours, with the theme's labels", async () => {
		await act(() => Uniwind.setTheme(theme));
		await render(chart());
		const bars = shapes("Rect").filter((rect) => rect.props.rx !== undefined);
		expect(bars).toHaveLength(6);
		expect(variables["--chart-1"]).toMatch(HEX);
		expect(bars.map((bar) => paint(bar.props.fill))).toEqual([
			variables["--chart-1"],
			variables["--chart-2"],
			variables["--chart-1"],
			variables["--chart-2"],
			variables["--chart-1"],
			variables["--chart-2"],
		]);
		const labels = shapes("Text");
		expect(labels.map(svgText)).toEqual(["0", "75", "150", "225", "300", "Mon", "Tue", "Wed"]);
		expect(labels.every((label) => paint(label.props.fill) === variables["--chart-label"])).toBe(
			true,
		);
		expect(labels[0]!.props.font).toMatchObject({ fontFamily: "JetBrains Mono", fontSize: 10 });
		expect(labels[5]!.props.font).toMatchObject({ fontFamily: "Manrope", fontWeight: 500 });
		const [grid] = shapes("Line");
		expect(paint(grid!.props.stroke)).toBe(variables["--chart-grid"]);
		expect(screen.getByText("requests.json")).toBeOnTheScreen();
		expect(screen.getByText("p99")).toBeOnTheScreen();
	});

	it("draws a line chart's points and shows a column's values when it is tapped", async () => {
		await act(() => Uniwind.setTheme(theme));
		await render(chart({ type: "line", series: ["p50"], unit: "ms" }));
		const points = shapes("Circle");
		expect(points).toHaveLength(3);
		expect(paint(points[0]!.props.stroke)).toBe(variables["--chart-1"]);
		expect(paint(points[0]!.props.fill)).toBe(variables["--surface-card"]);
		const hits = shapes("Rect").filter((rect) => rect.props.onResponderRelease);
		expect(hits).toHaveLength(3);
		await tap(hits[2]!);
		const readout = shapes("Text").find((label) => svgText(label) === "51ms");
		expect(paint(readout?.props.fill)).toBe(variables["--text-heading"]);
		expect(shapes("Circle")[2]!.props.r).toBe(4.5);
		await tap(shapes("Rect").filter((rect) => rect.props.onResponderRelease)[2]!);
		expect(shapes("Text").some((label) => svgText(label) === "51ms")).toBe(false);
	});

	it("bins a histogram and draws it at the width the card lays out", async () => {
		await act(() => Uniwind.setTheme(theme));
		await render(chart({ type: "histogram", values: [1, 2, 2, 3, 3, 3, 8], bins: 4 }));
		const bins = shapes("Rect").filter((rect) => !rect.props.onResponderRelease);
		expect(bins).toHaveLength(4);
		expect(bins.every((bin) => paint(bin.props.fill) === variables["--chart-1"])).toBe(true);
		const body = screen.container.queryAll((node) => typeof node.props.onLayout === "function");
		await fireEvent(body[0]!, "layout", { nativeEvent: { layout: { width: 352, height: 260 } } });
		// 352 less the body's padding: the plot is drawn at 320 wide, not shrunk from 640.
		const [plot] = shapes("SvgView").filter((svg) => svg.props.role === "img");
		expect(plot!.props.vbWidth).toBe(320);
	});
});

describe.each(THEMES)("Sparkline in the %s theme", (theme) => {
	const { variables } = resolveTheme(sheet, theme);

	it("paints the series colour an author names with its token", async () => {
		await act(() => Uniwind.setTheme(theme));
		await render(
			<Text>
				Trend <Sparkline values={[1, 3, 2]} width={84} height={20} color="var(--chart-3)" fill />
			</Text>,
		);
		const [area, line] = shapes("Path");
		expect(line!.props.d).toBe("M1.0 18.0 L42.0 2.0 L83.0 10.0");
		expect(paint(line!.props.stroke)).toBe(variables["--chart-3"]);
		expect(paint(area!.props.fill)).toBe(variables["--chart-3"]);
		expect(paint(shapes("Circle")[0]!.props.fill)).toBe(variables["--chart-3"]);
	});

	it("falls back to the first series colour for a variable the app cannot read", async () => {
		await act(() => Uniwind.setTheme(theme));
		await render(<Sparkline values={[1, 3]} width={84} height={20} color="var(--brand)" fill />);
		expect(paint(shapes("Path")[1]!.props.stroke)).toBe(variables["--chart-1"]);
	});
});
