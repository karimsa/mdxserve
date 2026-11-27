import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TocEntry } from "@mdxserve/client/document/tree-types";
import { Heading, Text } from "@mdxserve/ui/primitives/Text";
import { useSideInsets } from "../side-insets";

/** One line of the table of contents: a heading or a tab, indented by its depth. */
export interface TocLine {
	id: string;
	label: string;
	depth: number;
	kind: "heading" | "tab";
}

/** The tree's table of contents in reading order, depth first, as the web's "On this page" lists it. */
export function tocLines(entries: readonly TocEntry[], depth = 0): TocLine[] {
	return entries.flatMap((entry) => [
		{ id: entry.id, label: entry.label, depth, kind: entry.kind },
		...tocLines(entry.children, depth + 1),
	]);
}

/**
 * The document's headings and tabs in a sheet, opened from the header's Contents item. Choosing
 * one closes the sheet and reveals it in the document.
 */
export function TocSheet({
	lines,
	visible,
	onClose,
	onChoose,
}: {
	lines: readonly TocLine[];
	visible: boolean;
	onClose(): void;
	onChoose(id: string): void;
}) {
	const insets = useSafeAreaInsets();
	const sideInsets = useSideInsets();
	return (
		<Modal
			visible={visible}
			animationType="slide"
			presentationStyle="pageSheet"
			onRequestClose={onClose}
		>
			<View className="flex-1 bg-surface-page">
				<View
					className="flex-row items-center justify-between border-b border-border-subtle py-3"
					style={sideInsets}
				>
					<Heading level={2}>Contents</Heading>
					<Pressable role="button" onPress={onClose} hitSlop={8}>
						<Text weight="semibold" tone="accent">
							Done
						</Text>
					</Pressable>
				</View>
				<ScrollView
					contentContainerStyle={[sideInsets, { paddingBottom: insets.bottom + 16 }]}
					testID="toc-sheet"
				>
					{lines.map((line) => (
						<Pressable
							key={line.id}
							role="button"
							accessibilityLabel={line.kind === "tab" ? `Tab ${line.label}` : line.label}
							onPress={() => onChoose(line.id)}
							className="border-b border-border-subtle py-3"
							style={{ paddingLeft: line.depth * 16 }}
						>
							<Text
								weight={line.depth === 0 ? "semibold" : "regular"}
								tone={line.kind === "tab" ? "muted" : "body"}
							>
								{line.label}
							</Text>
						</Pressable>
					))}
				</ScrollView>
			</View>
		</Modal>
	);
}
