import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { mdxCompileOptions } from "../../src/rendering/mdx/mdx-options";
import { Table } from "../../client/Table";
import { MarkdownTable } from "../../client/MarkdownTable";
import DataTable from "../../client/builtins/DataTable";
import {
	autoUnit,
	inferColumn,
	compareValues,
	filterPredicate,
	formatValue,
	parseBound,
	unitFactor,
	type Column,
} from "../../client/data-table/model";

const number: Column = { key: "value", label: "Value", type: "number" };
const percent: Column = { ...number, type: "percent" };
const time: Column = { ...number, type: "time", unit: "milliseconds" };
const size: Column = { ...number, type: "bytes", unit: "KB" };
const currency: Column = { ...number, type: "currency", format: (value) => `$${value.toFixed(2)}` };
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
	it("requires identity, numeric measures, base units and currency formatters", () => {
		const render = (props: object) =>
			renderToStaticMarkup(createElement(DataTable, props as never));
		expect(() => render({ columns: [number], data: [] })).toThrow();
		expect(() =>
			render({ id: "table", columns: [{ ...number, type: "time" }], data: [] }),
		).toThrow();
		expect(() =>
			render({ id: "table", columns: [{ ...number, type: "currency" }], data: [] }),
		).toThrow();
		expect(() => render({ id: "table", columns: [number], data: [{ value: "12" }] })).toThrow();
		expect(() => render({ id: "table", columns: [number, number], data: [] })).toThrow();
	});
});
async function renderMarkdown(source: string, extension = "md") {
	const { providerImportSource: _, ...options } = mdxCompileOptions();
	const result = await evaluate(
		{ value: source, path: `table.${extension}` },
		{ ...options, ...runtime },
	);
	return renderToStaticMarkup(
		createElement(result.default, {
			components: { table: MarkdownTable, Table: MarkdownTable, DataTable },
		}),
	);
}
describe("Markdown integration", () => {
	it.each([MarkdownTable, Table])(
		"forwards native table attributes when no header is recognized (%#)",
		(Component) => {
			const html = renderToStaticMarkup(
				createElement(
					Component,
					{
						id: "custom-table",
						className: "custom-layout",
						style: { width: "50%", borderSpacing: "4px" },
						"aria-label": "Accessible custom table",
						"aria-describedby": "table-description",
						role: "grid",
						tabIndex: 0,
						title: "Custom title",
					},
					createElement(
						"tbody",
						null,
						createElement("tr", null, createElement("td", null, "Content")),
					),
				),
			);

			const tableTag = html.match(/<table\b[^>]*>/)?.[0];
			expect(tableTag).toContain('id="custom-table"');
			expect(tableTag).toContain('class="custom-layout"');
			expect(tableTag).toContain('style="width:50%;border-spacing:4px"');
			expect(tableTag).toContain('aria-label="Accessible custom table"');
			expect(tableTag).toContain('aria-describedby="table-description"');
			expect(tableTag).toContain('role="grid"');
			expect(tableTag).toContain('tabindex="0"');
			expect(tableTag).toContain('title="Custom title"');
			expect(html).toContain("<td>Content</td>");
		},
	);

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

	it("forwards attributes to the inner table when reconstructing a recognized header", async () => {
		const html = await renderMarkdown(
			'<Table id="custom" aria-label="Custom label" aria-describedby="details" className="layout" style={{width:"50%"}} tabIndex={0}><thead><tr><th>Name</th></tr></thead><tbody><tr><td>API</td></tr></tbody></Table>',
		);
		expect(html).toContain('data-table-id="custom"');
		const tag = html.match(/<table\b[^>]*>/)?.[0];
		for (const attribute of [
			'id="custom"',
			'aria-label="Custom label"',
			'aria-describedby="details"',
			'class="layout"',
			'style="width:50%"',
			'tabindex="0"',
		])
			expect(tag).toContain(attribute);
	});

	it.each([
		[
			"multiple header rows",
			"<thead><tr><th>First</th></tr><tr><th>Second</th></tr></thead><tbody><tr><td>Value</td></tr></tbody>",
			"<th>Second</th>",
		],
		[
			"header colspan",
			"<thead><tr><th colSpan={2}>Group</th></tr></thead><tbody><tr><td>One</td><td>Two</td></tr></tbody>",
			'colSpan="2"',
		],
		[
			"body rowspan",
			"<thead><tr><th>Name</th></tr></thead><tbody><tr><td rowSpan={2}>Both</td></tr><tr></tr></tbody>",
			'rowSpan="2"',
		],
		[
			"body colspan",
			"<thead><tr><th>One</th><th>Two</th></tr></thead><tbody><tr><td colSpan={2}>Both</td></tr></tbody>",
			'colSpan="2"',
		],
		[
			"footer",
			"<thead><tr><th>Name</th></tr></thead><tbody><tr><td>One</td></tr></tbody><tfoot><tr><td>Total</td></tr></tfoot>",
			"<tfoot>",
		],
		[
			"caption",
			"<caption>Important caption</caption><thead><tr><th>Name</th></tr></thead><tbody><tr><td>One</td></tr></tbody>",
			"<caption>Important caption</caption>",
		],
		[
			"multiple bodies",
			"<thead><tr><th>Name</th></tr></thead><tbody><tr><td>One</td></tr></tbody><tbody><tr><td>Two</td></tr></tbody>",
			"<td>Two</td>",
		],
		[
			"uneven rows",
			"<thead><tr><th>Name</th></tr></thead><tbody><tr><td>One</td><td>Extra</td></tr></tbody>",
			"<td>Extra</td>",
		],
	])("preserves native structure for %s", async (_, children, expected) => {
		const source = `<Table id="complex" aria-label="Native table">${children}</Table>`;
		const html = await renderMarkdown(source);
		expect(html).toBe(await renderMarkdown(source, "mdx"));
		expect(html.toLowerCase()).toContain(expected.toLowerCase());
		expect(html).toContain('id="complex"');
		expect(html).not.toContain("data-table-id");
	});

	it.each(["thead", "tbody", "tr", "th", "td"])(
		"preserves authored attributes on %s descendants",
		async (tag) => {
			const children = "<thead><tr><th>Name</th></tr></thead><tbody><tr><td>East</td></tr></tbody>";
			const source = `<Table>${children.replace(`<${tag}>`, `<${tag} className="authored" style={{color:"red"}} aria-label="Custom descendant" title="Keep this" onClick={() => {}}>`)}</Table>`;
			const html = await renderMarkdown(source);
			expect(html).toBe(await renderMarkdown(source, "mdx"));
			expect(html).toContain(
				`class="authored" style="color:red" aria-label="Custom descendant" title="Keep this"`,
			);
			expect(html).not.toContain("data-table-id");
		},
	);

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

	it("preserves alignment from native cell attributes", () => {
		const html = renderToStaticMarkup(
			createElement(
				MarkdownTable,
				{ id: "alignment" },
				createElement(
					"thead",
					null,
					createElement("tr", null, createElement("th", { align: "right" }, "Name")),
				),
				createElement(
					"tbody",
					null,
					createElement("tr", null, createElement("td", { align: "right" }, "East")),
				),
			),
		);

		expect(html).toMatch(/<th\b[^>]*data-align="right"/);
		expect(html).toMatch(/<td\b[^>]*data-align="right"/);
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
