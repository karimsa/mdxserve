import { memo, type ComponentType, type ReactNode } from "react";
import { plainText } from "@mdxserve/client/document/plain-text";
import type { InlineNode, TableNode } from "@mdxserve/client/document/tree-types";
import { inferColumn, parseBound, type Column, type Row } from "../data-table/model";
import type { DataTableViewProps } from "../data-table/props";
import { CellText } from "./elements";
import { useDocumentEnvironment } from "./environment";

/**
 * A Markdown table from the document tree, shown through `DataTable` so it
 * sorts and filters like the builtin: each column's type is inferred from its
 * cells' text, and every cell except a converted unit cell keeps its own
 * rendered content. Preferences persist under the table's id unless the
 * server marked that id ambiguous. The table is the environment's `DataTable` (the web client's
 * puts its column menus on the page body).
 */
export const MarkdownTableView = memo(function MarkdownTableView({
	node,
	renderInline,
}: {
	node: TableNode;
	renderInline: (nodes: readonly InlineNode[]) => ReactNode;
}) {
	const DataTable = useDocumentEnvironment().components
		.DataTable as ComponentType<DataTableViewProps>;
	const width = node.head.length;
	const rows = node.rows.map((row) =>
		Array.from({ length: width }, (_, index) => row[index] ?? ([] as InlineNode[])),
	);
	const columns: Column[] = node.head.map((cell, index) => {
		const align = node.align[index] ?? undefined;
		const column = inferColumn(
			`column-${index}`,
			plainText(cell) || `Column ${index + 1}`,
			rows.map((row) => plainText(row[index])),
		);
		// Converting units must never erase a link or an inline component.
		if (
			(column.type === "time" || column.type === "bytes") &&
			rows.some((row) => row[index].some((child) => child.type !== "text"))
		)
			return { key: column.key, label: column.label, type: "text", align };
		return { ...column, align };
	});
	const data: Row[] = rows.map((row) =>
		Object.fromEntries(
			columns.map((column, index) => {
				const value = plainText(row[index]).trim();
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

	return (
		<DataTable
			id={node.id}
			columns={columns}
			data={data}
			persistState={node.persist}
			tableProps={{ id: node.id }}
			renderHeader={(key) => {
				const cell = node.head[Number(key.slice(7))];
				return (
					<CellText header={true} block={cell}>
						{renderInline(cell ?? [])}
					</CellText>
				);
			}}
			renderCell={(row, key) => {
				const index = Number(key.slice(7));
				const column = columns[index];
				// Unit columns use DataTable's shared-unit formatter.
				if (column.type === "time" || column.type === "bytes") return undefined;
				const cell = rows[row]?.[index];
				return (
					<CellText header={false} block={cell}>
						{renderInline(cell ?? [])}
					</CellText>
				);
			}}
		/>
	);
});
