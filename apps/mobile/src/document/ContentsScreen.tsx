import { router, Stack } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";
import { Text } from "@mdxserve/ui/primitives/Text";
import { useContentsView, useContentsViews, type TocLine } from "./contents";

/** The space between a row's text and the sheet's edges, inside the safe area. */
const GUTTER = 16;
/** How far each level of the table of contents is indented. */
const INDENT = 16;

function close() {
	if (router.canGoBack()) router.back();
}

/** What VoiceOver reads for a row: its text, then whether it is a tab or a heading's level. */
function lineLabel(line: TocLine): string {
	if (line.kind === "tab") return `${line.label}, tab`;
	return line.level === null ? line.label : `${line.label}, heading level ${line.level}`;
}

/**
 * The open document's headings and tabs (app/contents.tsx), in a sheet under the system's own
 * navigation bar, opaque and in the page colour: its title, "Contents", comes from the route's
 * options, and Done is a native bar item with an SF Symbol, so a folded iPhone Duo moves it
 * into its vertical bar. Choosing a
 * line closes the sheet and reveals it in the document, selecting the tabs on the way.
 *
 * The sheet has a safe area provider of its own, so the insets are the sheet's and not the
 * window's: the rows stay clear of a folded display's vertical bar where the sheet meets it,
 * and take none where the sheet sits inside the window. The list clears the bar and the home
 * indicator through the scroll view's own inset adjustment.
 */
export function ContentsScreen({ viewKey }: { viewKey: string }) {
	const views = useContentsViews();
	const view = useContentsView(viewKey);
	useEffect(() => () => views.close(viewKey), [views, viewKey]);
	const barColour = useResolveClassNames("bg-surface-page").backgroundColor;
	return (
		<SafeAreaProvider>
			{/* The bar in the list's own colour, so the two read as one sheet. */}
			<Stack.Screen
				options={{
					headerStyle: { backgroundColor: typeof barColour === "string" ? barColour : undefined },
				}}
			/>
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Button
					icon="checkmark"
					variant="done"
					accessibilityLabel="Done"
					onPress={close}
				/>
			</Stack.Toolbar>
			<ContentsList
				lines={view?.lines ?? null}
				onChoose={(id) => {
					close();
					view?.choose(id);
				}}
			/>
		</SafeAreaProvider>
	);
}

function ContentsList({
	lines,
	onChoose,
}: {
	lines: readonly TocLine[] | null;
	onChoose(id: string): void;
}) {
	const insets = useSafeAreaInsets();
	return (
		<ScrollView
			className="flex-1 bg-surface-page"
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={{
				paddingLeft: insets.left,
				paddingRight: insets.right,
				paddingBottom: GUTTER,
			}}
			testID="contents-list"
		>
			{lines === null ? (
				<View style={{ padding: GUTTER }}>
					<Text tone="muted">This document is no longer open.</Text>
				</View>
			) : (
				lines.map((line) => (
					<Pressable
						key={line.id}
						role="button"
						accessibilityLabel={lineLabel(line)}
						onPress={() => onChoose(line.id)}
						className="border-b border-border-subtle py-3"
						style={{ paddingLeft: GUTTER + line.depth * INDENT, paddingRight: GUTTER }}
					>
						<Text
							weight={line.depth === 0 ? "semibold" : "regular"}
							tone={line.kind === "tab" ? "muted" : "body"}
						>
							{line.label}
						</Text>
					</Pressable>
				))
			)}
		</ScrollView>
	);
}
