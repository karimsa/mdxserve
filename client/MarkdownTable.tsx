import { Children, isValidElement, useId, type ReactNode, type TableHTMLAttributes } from "react";
import DataTable from "./builtins/DataTable";
import { inferColumn, parseBound, type Column, type Row } from "./data-table/model";

function elements(children: ReactNode) {
	return Children.toArray(children).filter(isValidElement<{ children?: ReactNode }>);
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
export function MarkdownTable({ children, id }: TableHTMLAttributes<HTMLTableElement>) {
	const fallbackId = useId();
	const sections = elements(children);
	const header = sections.find((section) => section.type === "thead");
	const body = sections.find((section) => section.type === "tbody");
	const headers = elements(elements(header?.props.children)[0]?.props.children);
	const cells = elements(body?.props.children).map((row) => elements(row.props.children));
	const columns: Column[] = headers.map((cell, index) => {
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
			return { key: column.key, label: column.label, type: "text" };
		return column;
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
	if (!columns.length)
		return (
			<div className="data-table">
				<div className="data-table-scroll">
					<table>{children}</table>
				</div>
			</div>
		);
	return (
		<DataTable
			id={id ?? `markdown-${fallbackId}`}
			columns={columns}
			data={data}
			renderCell={(row, key) => {
				const index = Number(key.slice(7));
				return columns[index].type === "time" || columns[index].type === "bytes"
					? undefined
					: cells[row][index]?.props.children;
			}}
		/>
	);
}
