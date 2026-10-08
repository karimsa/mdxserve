import {
	Children,
	isValidElement,
	useId,
	type CSSProperties,
	type ReactNode,
	type TableHTMLAttributes,
} from "react";
import DataTable from "./builtins/DataTable";
import { inferColumn, parseBound, type Column, type Row } from "./data-table/model";

function elements(children: ReactNode) {
	return Children.toArray(children).filter(
		isValidElement<{
			children?: ReactNode;
			align?: string;
			style?: CSSProperties;
			rowSpan?: number;
			colSpan?: number;
		}>,
	);
}

function text(children: ReactNode): string {
	return Children.toArray(children)
		.map((child) =>
			isValidElement<{ children?: ReactNode }>(child)
				? text(child.props.children)
				: typeof child === "string" || typeof child === "number"
					? String(child)
					: "",
		)
		.join("");
}

type TableElement = ReturnType<typeof elements>[number];

function isElementOnly(children: ReactNode): boolean {
	return Children.toArray(children).every(
		(child) => isValidElement(child) || (typeof child === "string" && !child.trim()),
	);
}

/** Rebuilt descendants only preserve children and the column-wide GFM alignment. */
function hasUnsupportedProps(element: TableElement, cell = false): boolean {
	return Object.keys(element.props).some((key) => {
		if (key === "children" || (cell && key === "align")) return false;
		if (cell && key === "style")
			return Object.keys(element.props.style ?? {}).some((property) => property !== "textAlign");
		return true;
	});
}

function rectangularCells(row: TableElement, cellType: "th" | "td"): TableElement[] | undefined {
	if (row.type !== "tr" || hasUnsupportedProps(row) || !isElementOnly(row.props.children))
		return undefined;
	const cells = elements(row.props.children);
	if (
		cells.some(
			(cell) =>
				cell.type !== cellType ||
				hasUnsupportedProps(cell, true) ||
				(cell.props.rowSpan !== undefined && cell.props.rowSpan !== 1) ||
				(cell.props.colSpan !== undefined && cell.props.colSpan !== 1),
		)
	)
		return undefined;
	return cells;
}

/** Only reconstruct a single rectangular header/body; preserve richer native structures intact. */
function tableStructure(children: ReactNode) {
	if (!isElementOnly(children)) return undefined;
	const sections = elements(children);
	if (sections.length !== 2 || sections[0].type !== "thead" || sections[1].type !== "tbody")
		return undefined;
	if (
		sections.some(
			(section) => hasUnsupportedProps(section) || !isElementOnly(section.props.children),
		)
	)
		return undefined;

	const headerRows = elements(sections[0].props.children);
	if (headerRows.length !== 1) return undefined;
	const headers = rectangularCells(headerRows[0], "th");
	if (!headers?.length) return undefined;

	const cells: TableElement[][] = [];
	for (const row of elements(sections[1].props.children)) {
		const rowCells = rectangularCells(row, "td");
		if (!rowCells || rowCells.length !== headers.length) return undefined;
		if (
			rowCells.some(
				(cell, index) =>
					(cell.props.style?.textAlign ?? cell.props.align) !==
					(headers[index].props.style?.textAlign ?? headers[index].props.align),
			)
		)
			return undefined;
		cells.push(rowCells);
	}
	return { headers, cells };
}

function prepareMarkdownTable(children: ReactNode) {
	const structure = tableStructure(children);
	if (!structure) return undefined;
	const { headers, cells } = structure;
	const columns: Column[] = headers.map((cell, index) => {
		const align = cell.props.style?.textAlign ?? cell.props.align;
		const alignment =
			align === "left" || align === "center" || align === "right" ? align : undefined;
		const column = inferColumn(
			`column-${index}`,
			text(cell.props.children) || `Column ${index + 1}`,
			cells.map((row) => text(row[index]?.props.children)),
		);
		// Converting units must never erase a link or an inline component.
		if (
			(column.type === "time" || column.type === "bytes") &&
			cells.some((row) => elements(row[index]?.props.children).length > 0)
		)
			return { key: column.key, label: column.label, type: "text", align: alignment };
		return { ...column, align: alignment };
	});
	const data: Row[] = cells.map((row) =>
		Object.fromEntries(
			columns.map((column, index) => {
				const value = text(row[index]?.props.children).trim();
				return [
					column.key,
					column.type === "text"
						? value
						: value === "" || value === "—"
							? null
							: (parseBound(value, column) ?? null),
				];
			}),
		),
	);

	return { columns, data, cells, headers };
}

function renderMarkdownCell(
	table: NonNullable<ReturnType<typeof prepareMarkdownTable>>,
	row: number,
	key: string,
) {
	const index = Number(key.slice(7));
	const column = table.columns[index];

	// Unit columns use DataTable's shared-unit formatter; other cells retain their original markup.
	if (column.type === "time" || column.type === "bytes") return undefined;
	return table.cells[row][index]?.props.children;
}

export function MarkdownTable({
	children,
	id,
	"data-table-persist": persist,
	...tableProps
}: TableHTMLAttributes<HTMLTableElement> & { "data-table-persist"?: string }) {
	const fallbackId = useId();
	const table = prepareMarkdownTable(children);

	if (!table)
		return (
			<div className="data-table">
				<div className="data-table-scroll">
					<table {...tableProps} id={id}>
						{children}
					</table>
				</div>
			</div>
		);

	return (
		<DataTable
			id={id ?? `markdown-${fallbackId}`}
			columns={table.columns}
			data={table.data}
			persistState={Boolean(id) && persist !== "false"}
			tableProps={{ ...tableProps, id }}
			renderHeader={(key) => table.headers[Number(key.slice(7))]?.props.children}
			renderCell={(row, key) => renderMarkdownCell(table, row, key)}
		/>
	);
}
