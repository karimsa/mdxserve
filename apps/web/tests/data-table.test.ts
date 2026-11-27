import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentService } from "@karimsa/mdxserve/src/document/service";
import { builtinRegistry } from "@karimsa/mdxserve/tests/helpers/components";
import { NodeList } from "../src/document/nodes";
import DataTable from "../src/builtins/DataTable";
import {
	autoUnit,
	inferColumn,
	compareValues,
	filterPredicate,
	formatValue,
	parseBound,
	unitFactor,
	type Column,
} from "@mdxserve/ui/data-table/model";

const number: Column = { key: "value", label: "Value", type: "number" };
const percent: Column = { ...number, type: "percent" };
const time: Column = { ...number, type: "time", unit: "milliseconds" };
const size: Column = { ...number, type: "bytes", unit: "KB" };
const currency: Column = { ...number, type: "currency", currency: "USD" };
describe("typed table values", () => {
	it("keeps saved numeric duration bounds meaningful when auto display units change", () => {
		expect(filterPredicate(time, { min: "1", unit: "s" }, "ms")(500)).toBe(false);
		expect(filterPredicate(time, { min: "1", unit: "s" }, "ms")(2000)).toBe(true);
	});
	it("infers only consistent units and preserves ambiguous columns as text", () => {
		expect(inferColumn("duration", "Duration", ["2s", "500ms"]).type).toBe("time");
		expect(inferColumn("size", "Size", ["1MB", "20KB"]).type).toBe("bytes");
		expect(inferColumn("mixed", "Mixed", ["1MB", "2s"]).type).toBe("text");
		expect(inferColumn("id", "ID", ["001", "002"]).type).toBe("text");
		expect(inferColumn("money", "Money", ["$1", "€2"]).type).toBe("text");
	});
	it("uses fractional source percentages and percentage-point filters", () => {
		expect(formatValue(0.15, percent)).toBe("15%");
		expect(parseBound("15%", percent)).toBe(0.15);
		expect(filterPredicate(percent, { min: "15", max: "20" })(0.18)).toBe(true);
	});
	it("converts duration aliases, explicit units and bare display values to the source unit", () => {
		expect(unitFactor("time", "hours")).toBe(3600000);
		expect(parseBound("2 seconds", time)).toBe(2000);
		expect(parseBound("2", time, "s")).toBe(2000);
		expect(autoUnit(time, [20, 2400, null])).toBe("s");
		expect(formatValue(500, time, "s")).toBe("0.5 s");
	});
	it("uses binary bytes and rejects unrecognized units instead of accepting a numeric prefix", () => {
		expect(parseBound("1MB", size)).toBe(1024);
		expect(formatValue(1024, size, "MB")).toBe("1 MB");
		expect(() => unitFactor("bytes", "potatoes")).toThrow();
		expect(() => parseBound("12oops", size)).toThrow();
	});
	it("expands currency suffixes without converting numeric source data to text", () => {
		expect(parseBound("10K", currency)).toBe(10000);
		expect(parseBound("-2.5M", currency)).toBe(-2500000);
		expect(formatValue(12.5, currency)).toBe("$12.50");
	});
	it("formats currency columns from a literal currency code", () => {
		expect(formatValue(1234.5, currency)).toBe("$1,234.50");
		expect(formatValue(-3, currency)).toBe("-$3.00");
		expect(formatValue(1234.5, { ...currency, currency: "EUR" })).toBe("€1,234.50");
		expect(formatValue(null, currency)).toBe("—");
	});
	it("sorts currency values numerically rather than by displayed text", () => {
		const values = [1234.5, 96.75, null, 18250];
		const sorted = [...values].sort((left, right) => compareValues(left, right, false));
		expect(sorted).toEqual([96.75, 1234.5, 18250, null]);
	});
	it("renders currency columns declared with literals only", () => {
		const html = renderToStaticMarkup(
			createElement(DataTable, {
				id: "costs",
				columns: [{ key: "cost", label: "Cost", type: "currency", currency: "USD" }],
				data: [{ cost: 1234.5 }, { cost: 96.75 }],
			} as never),
		);
		expect(html).toContain("$1,234.50");
		expect(html).toContain("$96.75");
	});
	it("matches regex case insensitively by default and reports invalid patterns", () => {
		const text: Column = { ...number, type: "text" };
		expect(filterPredicate(text, { pattern: "^api$" })("API")).toBe(true);
		expect(filterPredicate(text, { pattern: "^api$", caseSensitive: true })("API")).toBe(false);
		expect(() => filterPredicate(text, { pattern: "[" })).toThrow();
	});
	it("uses inclusive bounds, preserves missing values, and rejects inverted or malformed bounds", () => {
		expect(filterPredicate(number, { min: "0", max: "10" })(0)).toBe(true);
		expect(filterPredicate(number, { min: "0", max: "10" })(10)).toBe(true);
		expect(filterPredicate(number, { min: "0" })(null)).toBe(false);
		expect(filterPredicate(number, {})(null)).toBe(true);
		expect(() => filterPredicate(number, { min: "10", max: "0" })).toThrow();
		expect(() => parseBound("3oops", number)).toThrow();
	});
	it("sorts numbers numerically and keeps missing values last in either direction", () => {
		for (const descending of [true, false]) {
			const values = [10, null, 2].sort((left, right) => compareValues(left, right, descending));
			expect(values).toEqual(descending ? [10, 2, null] : [2, 10, null]);
		}
	});
	it("requires identity, numeric measures, base units and currency codes", () => {
		const render = (props: object) =>
			renderToStaticMarkup(createElement(DataTable, props as never));
		expect(() => render({ columns: [number], data: [] })).toThrow();
		expect(() =>
			render({ id: "table", columns: [{ ...number, type: "time" }], data: [] }),
		).toThrow();
		// A currency column without a code is a validation error, never a silent default.
		expect(() =>
			render({ id: "table", columns: [{ ...number, type: "currency" }], data: [] }),
		).toThrow();
		expect(() =>
			render({
				id: "table",
				columns: [{ ...number, type: "currency", currency: "usd" }],
				data: [],
			}),
		).toThrow();
		expect(() =>
			render({
				id: "table",
				columns: [{ ...number, type: "currency", format: () => "$1" }],
				data: [],
			}),
		).toThrow();
		expect(() => render({ id: "table", columns: [number], data: [{ value: "12" }] })).toThrow();
		expect(() => render({ id: "table", columns: [number, number], data: [] })).toThrow();
	});
});
/** Render a document the way the viewer does: parsed to the tree, then through the node renderers. */
async function renderMarkdown(source: string, extension = "md") {
	const { tree } = new DocumentService(builtinRegistry, (relative) => relative).parse(
		source,
		`/docs/table.${extension}`,
	);
	return renderToStaticMarkup(createElement(NodeList, { nodes: tree.children }));
}
describe("Markdown integration", () => {
	it.each(["md", "mdx"])("preserves formatted and linked headers in %s", async (extension) => {
		const html = await renderMarkdown(
			"| `--flag` | **Bold** | [Help](#help) |\n| --- | --- | --- |\n| yes | value | link |",
			extension,
		);
		const header = html.match(/<thead>[\s\S]*?<\/thead>/)?.[0];
		expect(header).toContain("<code>--flag</code>");
		expect(header).toContain("<strong>Bold</strong>");
		expect(header).toContain('<a href="#help">Help</a>');
		for (const [button] of header?.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [])
			expect(button).not.toContain("<a ");
	});

	it("keeps a written <table>'s native structure instead of rebuilding it as a DataTable", async () => {
		const html = await renderMarkdown(
			"<table>\n<thead><tr><th>First</th></tr><tr><th>Second</th></tr></thead>\n<tbody><tr><td>Value</td></tr></tbody>\n</table>\n",
		);
		expect(html).toContain(
			"<table><thead><tr><th>First</th></tr><tr><th>Second</th></tr></thead><tbody><tr><td>Value</td></tr></tbody></table>",
		);
		expect(html).not.toContain("data-table-id");
	});

	it("keeps identities with heading context when identical-header tables are inserted or moved", async () => {
		const table = "| Name | Count |\n| --- | --- |\n| East | 12 |";
		const ids = (html: string) =>
			[...html.matchAll(/data-table-id="([^"]+)"/g)].map((match) => match[1]);
		const original = ids(await renderMarkdown(`## Alpha\n\n${table}\n\n## Beta\n\n${table}`));
		const inserted = ids(
			await renderMarkdown(`## New\n\n${table}\n\n## Alpha\n\n${table}\n\n## Beta\n\n${table}`),
		);
		const moved = ids(await renderMarkdown(`## Beta\n\n${table}\n\n## Alpha\n\n${table}`));
		expect(inserted.slice(1)).toEqual(original);
		expect(moved).toEqual([...original].reverse());
	});

	it("disables persistence for ambiguous generated identities", async () => {
		const table = "| Name | Count |\n| --- | --- |\n| East | 12 |";
		const html = await renderMarkdown(`${table}\n\n${table}`);
		expect([...html.matchAll(/data-table-persist="([^"]+)"/g)].map((match) => match[1])).toEqual([
			"false",
			"false",
		]);
		expect(await renderMarkdown(table)).toContain('data-table-persist="true"');
	});

	it.each(["md", "mdx"])(
		"preserves explicit GFM alignment independently of inferred types in %s",
		async (extension) => {
			const html = await renderMarkdown(
				[
					"| Text | Count | Percent | Duration | Rich duration | Default text | Default number |",
					"| ---: | :--- | :---: | :--- | ---: | --- | --- |",
					"| East | 12 | 99% | 2s | **2s** | West | 42 |",
				].join("\n"),
				extension,
			);
			const expected = ["right", "left", "center", "left", "right", "left", "right"];

			for (const tag of ["th", "td"]) {
				const cells = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))];
				expect(cells.map(([cell]) => /data-align="([^"]+)"/.exec(cell)?.[1])).toEqual(expected);
			}

			expect(html).toContain("<strong>2s</strong>");
		},
	);
	it("normalizes native duration and byte columns into one display unit", async () => {
		const html = await renderMarkdown(
			"| Duration | Size |\n| --- | --- |\n| 2s | 1MB |\n| 500ms | 512KB |",
		);
		expect(html).toContain("0.5 s");
		expect(html).toContain("0.5 MB");
	});
	it("renders identical native tables in md and mdx, preserving links and inline formatting", async () => {
		const source =
			"| Name | Count |\n| --- | ---: |\n| **East** | 12 |\n| [West](https://example.com) | 2 |";
		const markdown = await renderMarkdown(source);
		expect(markdown).toBe(await renderMarkdown(source, "mdx"));
		expect(markdown).toContain('data-table-id="markdown-table-');
		expect(markdown).toContain("<strong>East</strong>");
		expect(markdown).toContain('href="https://example.com"');
		expect(markdown).toContain('data-numeric="true"');
		expect(markdown).not.toContain('class="data-table-bar"');
	});
	it("preserves native identity across row edits and distinguishes same-header tables", async () => {
		const source = "| Name | Count |\n| --- | --- |\n| East | 12 |";
		const id = (html: string) =>
			[...html.matchAll(/data-table-id="([^"]+)"/g)].map((match) => match[1]);
		expect(id(await renderMarkdown(source))).toEqual(
			id(await renderMarkdown(source.replace("12", "42"))),
		);
		const ids = id(await renderMarkdown(`${source}\n\n${source}`));
		expect(new Set(ids).size).toBe(2);
	});
	it("does not coerce mixed text or leading-zero identifiers into numbers", async () => {
		const html = await renderMarkdown(
			"| ID | Mixed |\n| --- | --- |\n| 001 | 12 |\n| 002 | pending |",
		);
		expect(html).not.toContain('data-numeric="true"');
	});
	it("renders grouped numeric tables in both extensions without client globals", async () => {
		const source =
			'<DataTable id="metrics" columns={[{key:"value",label:"Value",type:"number",group:"Totals",bars:true}]} data={[{value:2},{value:-1}]} />';
		const html = await renderMarkdown(source);
		expect(html).toBe(await renderMarkdown(source, "mdx"));
		expect(html).toContain('scope="colgroup"');
		expect(html).toContain('class="data-table-bar"');
	});
});
