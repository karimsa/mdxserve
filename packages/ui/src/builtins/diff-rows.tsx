import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Pressable } from "../primitives/Pressable";
import { FadeInView } from "../primitives/motion";
import {
	marker,
	rowClasses,
	toSplitRows,
	visibleBlocks,
	type DiffHunkRow,
	type DiffRow,
} from "./diff-model";

/*
 * The app's diff rows: a grid of Views, each side scrolling sideways on its own. Every line is
 * one 20 px row, so the two sides of the split view stay level. The web's are tables
 * (diff-rows.web.tsx).
 */

/** JetBrains Mono's advance is 0.6 em; the code is 12 px. */
const CHAR_WIDTH = 7.2;

const CODE = "font-mono font-normal text-[length:var(--size-xs)] leading-5";

/** A line-number column wide enough for the largest number in `rows`, plus its padding. */
function numberWidth(rows: readonly DiffRow[]): number {
	const largest = Math.max(1, ...rows.map((row) => Math.max(row.oldNo ?? 0, row.newNo ?? 0)));
	return String(largest).length * CHAR_WIDTH + 16;
}

function Segments({ row }: { row: DiffRow }) {
	if (row.text === "") return " ";
	if (!row.segments) return row.text;
	const highlight = row.kind === "add" ? "bg-status-ok-fg/35" : "bg-status-danger-fg/35";
	return row.segments.map((segment, index) => (
		<Text key={index} className={segment.changed ? highlight : undefined}>
			{segment.text}
		</Text>
	));
}

function Line({
	row,
	numbers,
	width,
}: {
	row: DiffRow;
	numbers: readonly (number | undefined)[];
	width: number;
}) {
	const { row: fill, gutter, text } = rowClasses(row.kind);
	return (
		<View className={`h-5 flex-row ${fill}`}>
			{numbers.map((number, index) => (
				<Text key={index} className={`px-2 text-right ${CODE} ${gutter}`} style={{ width }}>
					{number ?? ""}
				</Text>
			))}
			{numbers.length > 1 ? (
				<Text className={`w-[15.2px] text-center ${CODE} ${gutter}`}>{marker(row.kind)}</Text>
			) : null}
			<Text className={`px-2 ${CODE} ${text}`}>
				<Segments row={row} />
			</Text>
		</View>
	);
}

function Separator({ count, onExpand }: { count: number; onExpand: () => void }) {
	return (
		<Pressable onPress={onExpand} className="bg-surface-accent-soft px-4 py-1">
			<Text className="font-sans leading-4 text-[length:var(--size-xs)] text-text-accent">
				{`↕ ${count} unchanged line${count === 1 ? "" : "s"}`}
			</Text>
		</Pressable>
	);
}

/** Lines that scroll sideways together, each at least as wide as the view. */
function Scroller({ children }: { children: ReactNode }) {
	return (
		<ScrollView
			horizontal={true}
			showsHorizontalScrollIndicator={false}
			contentContainerStyle={{ minWidth: "100%", flexDirection: "column" }}
		>
			{children}
		</ScrollView>
	);
}

interface ViewProps {
	rows: DiffHunkRow[];
	expanded: Set<number>;
	onExpand: (index: number) => void;
}

export function UnifiedView({ rows, expanded, onExpand }: ViewProps) {
	return visibleBlocks(rows, expanded).map((block, index) => {
		if (block.type === "separator")
			return <Separator key={index} count={block.count} onExpand={() => onExpand(block.index)} />;
		const width = numberWidth(block.rows);
		return (
			<Scroller key={index}>
				{block.rows.map((row, rowIndex) => (
					<Line key={rowIndex} row={row} numbers={[row.oldNo, row.newNo]} width={width} />
				))}
			</Scroller>
		);
	});
}

function EmptyLine() {
	return <View className="h-5 bg-surface-sunken" />;
}

export function SplitView({ rows, expanded, onExpand }: ViewProps) {
	return visibleBlocks(rows, expanded).map((block, index) => {
		if (block.type === "separator")
			return <Separator key={index} count={block.count} onExpand={() => onExpand(block.index)} />;
		const splitRows = toSplitRows(block.rows);
		const width = numberWidth(block.rows);
		return (
			<View key={index} className="flex-row">
				<View className="flex-1 border-r border-code-border">
					<Scroller>
						{splitRows.map(({ left }, rowIndex) =>
							left ? (
								<Line key={rowIndex} row={left} numbers={[left.oldNo]} width={width} />
							) : (
								<EmptyLine key={rowIndex} />
							),
						)}
					</Scroller>
				</View>
				<View className="flex-1">
					<Scroller>
						{splitRows.map(({ right }, rowIndex) =>
							right ? (
								<Line key={rowIndex} row={right} numbers={[right.newNo]} width={width} />
							) : (
								<EmptyLine key={rowIndex} />
							),
						)}
					</Scroller>
				</View>
			</View>
		);
	});
}

/** Both views stay mounted; the active one shows, fading in each time it becomes active. */
export function DiffPanes({
	active,
	unified,
	split,
}: {
	active: "unified" | "split";
	unified: ReactNode;
	split: ReactNode;
}) {
	return (
		<>
			<FadeInView shown={active === "unified"} className={active === "unified" ? "" : "hidden"}>
				{unified}
			</FadeInView>
			<FadeInView shown={active === "split"} className={active === "split" ? "" : "hidden"}>
				{split}
			</FadeInView>
		</>
	);
}
