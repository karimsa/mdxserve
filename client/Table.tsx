import type { TableHTMLAttributes } from "react";

/**
 * MDXProvider `table` override. Tables with long cells (paths, code) can't
 * shrink below their content, so without this they'd overflow the prose column
 * and run under the TOC rail. Each table scrolls inside its own container.
 */
export function Table(props: TableHTMLAttributes<HTMLTableElement>) {
	return (
		<div className="mdx-table-scroll">
			<table {...props} />
		</div>
	);
}
