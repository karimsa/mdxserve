// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sparkline from "@mdxserve/ui/builtins/Sparkline";
import Chart from "../src/builtins/Chart";

// Chart and Sparkline (@mdxserve/ui) as the browser gets them: react-native-svg's web elements
// through react-native-web, drawing the same SVG the web client drew before they moved.

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	vi.unstubAllGlobals();
});

function draw(element: ReactElement) {
	act(() => root.render(element));
}

const WEEK = [
	{ label: "Mon", p50: 42, p99: 180 },
	{ label: "Tue", p50: 38, p99: 165 },
	{ label: "Wed", p50: 51, p99: 210 },
];

describe("Sparkline", () => {
	it("draws an inline SVG in a paragraph, painted with the token", () => {
		draw(
			<p>
				Trend <Sparkline values={[1, 3, 2]} width={84} height={20} color="var(--chart-1)" fill />
			</p>,
		);
		const svg = host.querySelector("p > svg")!;
		expect(svg.getAttribute("class")).toBe("not-prose inline-block align-middle");
		expect(svg.getAttribute("viewBox")).toBe("0 0 84 20");
		expect(svg.getAttribute("role")).toBe("img");
		const [area, line] = svg.querySelectorAll("path");
		expect(line.getAttribute("d")).toBe("M1.0 18.0 L42.0 2.0 L83.0 10.0");
		expect(line.getAttribute("stroke")).toBe("var(--chart-1)");
		expect(area.getAttribute("d")).toBe("M1.0 18.0 L42.0 2.0 L83.0 10.0 L83 20 L1 20 Z");
		expect(area.getAttribute("opacity")).toBe("0.13");
		expect(svg.querySelector("circle")!.getAttribute("cx")).toBe("83");
	});

	it("draws nothing for fewer than two numbers", () => {
		draw(<Sparkline values={[4]} width={84} height={20} color="red" fill />);
		expect(host.querySelector("svg")).toBeNull();
	});
});

describe("Chart", () => {
	it("draws one bar per value in a figure, with the series tokens and the type classes", () => {
		draw(
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
			/>,
		);
		const figure = host.querySelector("figure")!;
		expect(figure.className).toContain("rounded-lg");
		expect(figure.textContent).toContain("requests.json");
		const svg = figure.querySelector('svg[role="img"]')!;
		expect(svg.getAttribute("width")).toBe("100%");
		expect(svg.getAttribute("viewBox")).toBe("0 0 640 220");
		const bars = [...svg.querySelectorAll('rect[rx="3"]')];
		expect(bars).toHaveLength(6);
		expect(bars.map((bar) => bar.getAttribute("fill"))).toEqual([
			"var(--chart-1)",
			"var(--chart-2)",
			"var(--chart-1)",
			"var(--chart-2)",
			"var(--chart-1)",
			"var(--chart-2)",
		]);
		const tick = svg.querySelector("text")!;
		expect(tick.getAttribute("class")).toContain("font-mono");
		expect(tick.getAttribute("fill")).toBe("var(--chart-label)");
		expect(tick.style.fontSize).toBe("10px");
		// The legend's two series and the header's menu and expand button.
		expect(figure.querySelectorAll(".bg-chart-1, .bg-chart-2")).toHaveLength(2);
		expect(figure.querySelector('button[aria-label="Expand chart"]')).not.toBeNull();
	});

	it("shows a column's values while the pointer is over it", () => {
		draw(
			<Chart
				id="week"
				type="line"
				orientation="vertical"
				data={WEEK}
				series={["p50"]}
				values={[]}
				height={220}
				unit="ms"
				legend
			/>,
		);
		const svg = host.querySelector('svg[role="img"]')!;
		const hits = [...svg.querySelectorAll('rect[fill="transparent"]')];
		expect(hits).toHaveLength(3);
		act(() => {
			hits[2].dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
		});
		expect(svg.textContent).toContain("51ms");
		expect(svg.querySelectorAll("circle")[2].getAttribute("r")).toBe("4.5");
	});
});
