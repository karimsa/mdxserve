import type { ReactNode } from "react";
import { dataTableProps, type DataTableProps } from "@mdxserve/shared/builtins/data-table";
import { unitFactor } from "./model";

/** What both clients' `DataTable` take: the builtin's props, plus what a Markdown table adds. */
export type DataTableViewProps = DataTableProps & {
	renderCell?: (row: number, key: string) => ReactNode;
	renderHeader?: (key: string) => ReactNode;
	/** The table's own id, which links and comment anchors reach a Markdown table by. */
	tableProps?: { id?: string };
	persistState?: boolean;
};

/** The props as the builtin's schema reads them, after the checks the schema cannot make. */
export function validateTableProps(props: DataTableViewProps): DataTableProps {
	const parsed = dataTableProps.parse(props);
	const keys = new Set(parsed.columns.map((column) => column.key));
	if (keys.size !== parsed.columns.length) throw new Error("DataTable column keys must be unique.");
	for (const column of parsed.columns) {
		if (column.type === "time" || column.type === "bytes") unitFactor(column.type, column.unit);
		if (
			parsed.data.some(
				(row) =>
					row[column.key] !== undefined &&
					row[column.key] !== null &&
					typeof row[column.key] !== (column.type === "text" ? "string" : "number"),
			)
		)
			throw new Error(
				`DataTable: ${column.key} requires ${column.type === "text" ? "text" : "numeric"} values.`,
			);
	}

	return parsed;
}
