import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import type { AnchorFields } from "@mdxserve/client/comments/anchor";
import { collectTreeBlocks } from "@mdxserve/client/comments/tree-blocks";
import { indexDocument } from "@mdxserve/client/document/document-index";
import type { DocumentTree } from "@mdxserve/client/document/tree-types";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { FootnoteContext, NodeList, type FootnoteInfo } from "@mdxserve/ui/document/nodes";
import { SelectableBlockContext } from "@mdxserve/ui/document/text-runs";
import { Text } from "@mdxserve/ui/primitives/Text";
import { appDocumentEnvironment } from "../document-environment";
import {
	DocumentSelectionContext,
	selectableBlock,
	type DocumentSelection,
} from "./SelectableBlock";

const text = (value: string) => ({ type: "text", value });

/**
 * The K-gate sample: a heading, then a paragraph with bold, a link, a short code chip, long code,
 * a soft line break, emphasis, strikethrough and a footnote reference, and a tight list.
 */
const CHECK_DOCUMENT = {
	schemaVersion: 1,
	metadata: { openGraph: [] },
	toc: [],
	children: [
		{
			type: "section",
			id: "selection-check",
			level: 2,
			heading: [text("Selection "), { type: "inlineCode", value: "check" }],
			children: [
				{
					type: "paragraph",
					children: [
						text("Select across "),
						{ type: "strong", children: [text("bold words")] },
						text(", "),
						{
							type: "link",
							href: "https://example.com/",
							title: null,
							children: [text("a link")],
						},
						text(", the chip "),
						{ type: "inlineCode", value: "npm" },
						text(" and "),
						{ type: "inlineCode", value: "some longer code that wraps" },
						text(" then a soft\nline break, "),
						{ type: "emphasis", children: [text("emphasis")] },
						text(", "),
						{ type: "delete", children: [text("struck")] },
						text(" and a footnote"),
						{ type: "footnoteReference", label: "one" },
						text(". Emoji 👋🏽 and café."),
					],
				},
				{
					type: "list",
					ordered: false,
					start: null,
					items: [
						{
							checked: null,
							children: [{ type: "paragraph", children: [text("A tight list item")] }],
						},
					],
				},
			],
		},
		{
			type: "footnoteDefinition",
			label: "one",
			children: [{ type: "paragraph", children: [text("The footnote.")] }],
		},
	],
} as unknown as DocumentTree;

function round(value: number): string {
	return value.toFixed(1);
}

/**
 * The selection check for the development build's first run (the K-gate): the sample drawn as
 * selectable text and, under it, drawn with `Text`, each block's two heights, and the anchor the
 * last Comment made. Choosing Comment here makes no thread; a link shows where it goes.
 */
export function SelectionCheck() {
	const [anchor, setAnchor] = useState<AnchorFields | null>(null);
	const [heights, setHeights] = useState<ReadonlyMap<object, { layout: number; native: number }>>(
		new Map(),
	);
	const [textHeight, setTextHeight] = useState(0);
	const [selectableHeight, setSelectableHeight] = useState(0);
	const index = useMemo(() => indexDocument(CHECK_DOCUMENT), []);
	const footnotes = useMemo<FootnoteInfo>(
		() => ({
			numbers: index.footnoteNumbers,
			counts: index.footnoteReferenceCounts,
			occurrences: index.footnoteOccurrences,
			references: index.footnoteReferences,
		}),
		[index],
	);
	const onHeights = useCallback(
		(block: object, measured: { layout: number; native: number }) =>
			setHeights((previous) => new Map(previous).set(block, measured)),
		[],
	);
	const selection = useMemo<DocumentSelection>(
		() => ({ blocks: collectTreeBlocks(CHECK_DOCUMENT), startThread: setAnchor, onHeights }),
		[onHeights],
	);
	const environment = useMemo(
		() => ({ ...appDocumentEnvironment, openLink: (href: string) => Alert.alert("Link", href) }),
		[],
	);
	const sample = <NodeList nodes={CHECK_DOCUMENT.children.slice(0, 1)} />;

	if (!selectableBlock)
		return (
			<Text tone="muted" paragraph={true}>
				Selectable text needs the development build: this app has no SelectableText module, so
				documents are drawn with Text and no text can be selected.
			</Text>
		);

	return (
		<DocumentEnvironmentProvider value={environment}>
			<FootnoteContext value={footnotes}>
				<DocumentSelectionContext value={selection}>
					<Text size="sm" tone="muted">
						Selectable text:
					</Text>
					<View
						testID="selection-check-selectable"
						onLayout={(event) => setSelectableHeight(event.nativeEvent.layout.height)}
					>
						<SelectableBlockContext value={selectableBlock}>{sample}</SelectableBlockContext>
					</View>
					<Text size="sm" tone="muted">
						The same blocks drawn with Text:
					</Text>
					<View onLayout={(event) => setTextHeight(event.nativeEvent.layout.height)}>
						<SelectableBlockContext value={null}>{sample}</SelectableBlockContext>
					</View>
					<Text size="sm" testID="selection-check-heights">
						{`Whole sample: selectable ${round(selectableHeight)} pt, Text ${round(textHeight)} pt.\n${[
							...heights.values(),
						]
							.map(
								(measured, position) =>
									`Block ${position + 1}: layout ${round(measured.layout)} pt, native ${round(measured.native)} pt`,
							)
							.join("\n")}`}
					</Text>
					<Text size="sm" testID="selection-check-anchor">
						{anchor
							? `Last Comment: heading ${JSON.stringify(anchor.heading)}, quote ${JSON.stringify(anchor.quote)}`
							: "Select some text and choose Comment: the quote it would store shows here."}
					</Text>
				</DocumentSelectionContext>
			</FootnoteContext>
		</DocumentEnvironmentProvider>
	);
}
