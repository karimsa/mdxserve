import { Stack } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { Text } from "@mdxserve/ui/primitives/Text";
import { useSideInsets } from "../../../src/side-insets";

/** Search across every server arrives with reading documents; this tab holds its place. */
export default function Search() {
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="search-content"
		>
			<Stack.Screen options={{ title: "Search" }} />
			<Text weight="semibold">Search is coming</Text>
			<Text tone="muted" paragraph={true}>
				Searching every server at once arrives in a later version of the app.
			</Text>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { gap: 4, paddingVertical: 16 },
});
