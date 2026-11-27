import { useState, type ReactNode } from "react";
import { ScrollView, Text as NativeText, useWindowDimensions, View } from "react-native";
import { useDocumentBlockScope } from "../block-state/useBlockState";
import { blockStateKey, type BlockStateScope } from "../block-state/storage";
import { CELL_PADDING, columnWidths, fitColumnWidths } from "../data-table/layout";
import { formatValue, type Column } from "../data-table/model";
import { validateTableProps, type DataTableViewProps } from "../data-table/props";
import {
	clearFilter,
	cycleSort,
	deriveTableView,
	filterSummary,
	hasFilter,
} from "../data-table/table-state";
import { useTableState } from "../data-table/useTableState";
import { Pressable } from "../primitives/Pressable";
import { Text, type TextProps } from "../primitives/Text";

const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;
/** A header's label, unit and sort indicator sit in a row, placed as the column's text is. */
const JUSTIFY = { left: "justify-start", center: "justify-center", right: "justify-end" } as const;

function alignment(column: Column) {
	return column.align ?? (column.type === "text" ? "left" : "right");
}

/** Digits line up down a column, as `font-variant-numeric: tabular-nums` does on the web. */
const TABULAR = { fontVariant: ["tabular-nums" as const] };

/**
 * A cell's text, aligned as its column is. A renderer's own nodes (a Markdown cell's inline
 * runs) sit inside a paragraph that carries the alignment: nested text takes its paragraph's
 * alignment, so the inline runs, chips and links wrap together within the column.
 */
function content(
	node: ReactNode,
	fallback: string,
	look: Omit<TextProps, "children" | "style" | "className">,
	align: keyof typeof ALIGN,
) {
	if (node !== undefined && node !== null && typeof node !== "string" && typeof node !== "number")
		return (
			<NativeText className={`shrink ${ALIGN[align]}`} style={TABULAR}>
				{node}
			</NativeText>
		);
	return (
		<Text {...look} className={`shrink ${ALIGN[align]}`} style={TABULAR}>
			{node ?? fallback}
		</Text>
	);
}

/**
 * The app's `DataTable`: a grid of views that scrolls sideways inside the document, with the
 * header row on top. Tapping a header cycles its sort (ascending, descending, none), the chips
 * clear a sort or a filter, and the reader state is the web's (useTableState). Filters and
 * display units are set from the web's column menu for now; the app shows and clears them.
 */
export default function DataTable(props: DataTableViewProps) {
	const parsed = validateTableProps(props);
	const scope = useDocumentBlockScope({ kind: "table", version: 1, blockId: parsed.id });

	return (
		<TableGrid
			key={blockStateKey(scope)}
			{...parsed}
			renderCell={props.renderCell}
			renderHeader={props.renderHeader}
			tableProps={props.tableProps}
			persistState={props.persistState}
			scope={scope}
		/>
	);
}

function TableGrid({
	id,
	caption,
	columns,
	data,
	renderCell,
	renderHeader,
	tableProps,
	persistState = true,
	scope,
}: DataTableViewProps & { scope: BlockStateScope }) {
	const [state, setState] = useTableState(scope, columns, persistState);
	const { units, errors, rows, bounds, groups } = deriveTableView(columns, data, state);
	const natural = columnWidths(columns, data, units);
	const naturalTotal = natural.reduce((sum, width) => sum + width, 0);
	// The width the grid is shown in, once laid out. A table that may be narrower than that is
	// hidden until then, so its columns never visibly grow; a wider one never changes.
	const [viewport, setViewport] = useState<number | null>(null);
	const { width: windowWidth } = useWindowDimensions();
	const widths = fitColumnWidths(natural, viewport ?? 0);
	const total = widths.reduce((sum, width) => sum + width, 0);
	const measuring = viewport === null && naturalTotal < windowWidth;
	const scrolls = total > (viewport ?? windowWidth);
	const filteredColumns = columns.filter((column) => hasFilter(state.filters[column.key]));
	const sortedColumn = columns.find((column) => column.key === state.sort?.key);
	/** Every cell of a column, header included, has the column's width exactly. */
	const cellBox = (index: number) => ({ width: widths[index] });

	return (
		<View
			testID={`data-table-${id}`}
			className="my-6 overflow-hidden rounded-lg border border-border-default bg-surface-card"
		>
			<View className="flex-row flex-wrap items-center gap-3 p-4">
				<Text size="sm" weight="semibold" tone="heading">
					{caption ?? "Table"}
				</Text>
				<Text size="xs" tone="muted">
					{data.length} rows
				</Text>
			</View>
			{(sortedColumn || filteredColumns.length > 0) && (
				<View className="flex-row flex-wrap gap-2 px-4 pb-3">
					{sortedColumn && (
						<Pressable
							aria-label="Clear sorting"
							onPress={() => setState((previous) => ({ ...previous, sort: undefined }))}
							className="rounded-[5px] border border-border-subtle px-2 py-0.5"
						>
							<Text size="xs" tone="muted">
								{sortedColumn.label} {state.sort?.descending ? "↓" : "↑"} ×
							</Text>
						</Pressable>
					)}
					{filteredColumns.map((column) => (
						<Pressable
							key={column.key}
							aria-label={`Clear ${column.label} filter`}
							onPress={() => setState((previous) => clearFilter(previous, column.key))}
							className="rounded-[5px] border border-border-subtle px-2 py-0.5"
						>
							<Text size="xs" tone="muted">
								{column.label}: {filterSummary(column, state.filters[column.key])} ×
							</Text>
						</Pressable>
					))}
				</View>
			)}

			{/* One sideways scroller for the header and every row. It opens at the first column and
			    keeps out of the way of safe-area insets, so nothing shifts it on a folded display;
			    a table that fits does not scroll at all, so it never takes a horizontal swipe. */}
			<ScrollView
				horizontal={true}
				testID={`data-table-${id}-scroll`}
				scrollEnabled={scrolls}
				showsHorizontalScrollIndicator={scrolls}
				directionalLockEnabled={true}
				automaticallyAdjustContentInsets={false}
				contentInsetAdjustmentBehavior="never"
				contentOffset={{ x: 0, y: 0 }}
				onLayout={(event) => setViewport(Math.round(event.nativeEvent.layout.width))}
				style={measuring ? { opacity: 0 } : undefined}
			>
				<View
					nativeID={tableProps?.id}
					aria-label={caption ?? "Data table"}
					style={{ width: total }}
				>
					{columns.some((column) => column.group) && (
						<View className="flex-row border-b border-border-subtle">
							{groups.map((group) => {
								const indexes = group.columns.map((column) => columns.indexOf(column));
								return (
									<View
										key={group.columns[0].key}
										className="min-h-6 justify-center px-4"
										style={{ width: indexes.reduce((sum, index) => sum + widths[index], 0) }}
									>
										<Text size="xs" tone="muted" className="text-center">
											{group.label}
										</Text>
									</View>
								);
							})}
						</View>
					)}
					<View className="flex-row border-b border-border-subtle">
						{columns.map((column, index) => {
							const sorted = state.sort?.key === column.key;
							const direction = state.sort?.descending ? "descending" : "ascending";
							const indicator = `${sorted ? (state.sort?.descending ? "↓" : "↑") : ""}${hasFilter(state.filters[column.key]) ? " •" : ""}`;
							return (
								<Pressable
									key={column.key}
									testID={`data-table-${id}-header-${index}`}
									aria-label={`${column.label} column header${sorted ? `, sorted ${direction}` : ""}`}
									onPress={() => setState((previous) => cycleSort(previous, column.key))}
									className={`min-h-11 flex-row items-end gap-1 px-4 py-2 ${JUSTIFY[alignment(column)]}`}
									style={cellBox(index)}
								>
									{content(
										renderHeader?.(column.key),
										column.label,
										{ size: "xs", tone: "muted" },
										alignment(column),
									)}
									{units[column.key] ? (
										<Text size="xs" tone="subtle">
											· {units[column.key]}
										</Text>
									) : null}
									{indicator ? (
										<Text size="xs" tone="accent">
											{indicator}
										</Text>
									) : null}
								</Pressable>
							);
						})}
					</View>
					{rows.map(({ row, index }, rowIndex) => (
						<View
							key={index}
							testID={`data-table-${id}-row`}
							className={`flex-row ${rowIndex === rows.length - 1 ? "" : "border-b border-border-subtle"}`}
						>
							{columns.map((column, columnIndex) => {
								const value = row[column.key] ?? null;
								const limits = bounds[column.key];
								const span = limits ? limits[1] - limits[0] : 0;
								const inner = widths[columnIndex] - CELL_PADDING;
								return (
									<View
										key={column.key}
										testID={`data-table-${id}-cell-${rowIndex}-${columnIndex}`}
										className={`min-h-[49px] justify-center px-4 ${limits ? "pt-2.5 pb-3.5" : "py-2.5"}`}
										style={cellBox(columnIndex)}
									>
										{limits && typeof value === "number" && span > 0 ? (
											<View
												aria-hidden={true}
												pointerEvents="none"
												className="absolute bottom-2 h-0.5 rounded-xs bg-border-accent opacity-65"
												style={{
													left: 16 + (inner * (Math.min(0, value) - limits[0])) / span,
													width: (inner * Math.abs(value)) / span,
												}}
											/>
										) : null}
										{content(
											renderCell?.(index, column.key),
											formatValue(value, column, units[column.key]),
											{ size: "sm" },
											alignment(column),
										)}
									</View>
								);
							})}
						</View>
					))}
					{rows.length === 0 && (
						<View className="min-h-[49px] justify-center px-4 py-2.5">
							<Text size="sm">No matching rows. Adjust or reset filters.</Text>
						</View>
					)}
				</View>
			</ScrollView>
			<View className="flex-row flex-wrap justify-between gap-2 border-t border-border-subtle px-4 py-2.5">
				<Text size="xs" tone="muted">
					{rows.length} of {data.length} rows
				</Text>
				{columns.some((column) => column.bars) && (
					<Text size="xs" tone="muted">
						Lines compare within each column
					</Text>
				)}
			</View>
			{Object.keys(errors).length > 0 && (
				<View role="alert" className="p-2">
					<NativeText className="font-sans text-[length:var(--size-xs)] text-status-danger-fg">
						Invalid filter:{" "}
						{columns
							.filter((column) => errors[column.key])
							.map((column) => column.label)
							.join(", ")}
						. Open its column menu on the web to correct it.
					</NativeText>
				</View>
			)}
		</View>
	);
}
