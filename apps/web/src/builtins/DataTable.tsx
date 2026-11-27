import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import SharedDataTable from "@mdxserve/ui/builtins/DataTable";
import type { DataTableViewProps } from "@mdxserve/ui/data-table/props";

/** A column menu goes on the page body, so the table's scroller cannot clip it. */
function toPageBody(menu: ReactNode): ReactNode {
	return typeof document === "undefined" ? null : createPortal(menu, document.body);
}

/** The shared DataTable (@mdxserve/ui), with the web's portal for its column menus. */
export default function DataTable(props: DataTableViewProps) {
	return <SharedDataTable {...props} portal={toPageBody} />;
}
