import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { Code, Text } from "@mdxserve/ui/primitives/Text";
import { baseName, pathFromSegments } from "../../../../../../src/library/paths";
import { useSideInsets } from "../../../../../../src/side-insets";

/** Where a document will be read. Reading arrives in the next version; this says so. */
export default function DocumentPlaceholder() {
	const { path } = useLocalSearchParams<{ serverId: string; path: string[] }>();
	const file = pathFromSegments(path);
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="document-content"
		>
			<Stack.Screen options={{ title: baseName(file) }} />
			<Text weight="semibold">Reading documents arrives next</Text>
			<Text tone="muted" paragraph={true}>
				This version of the app lists your folders. Opening a document comes in the next one.
			</Text>
			<Text size="sm">
				<Code>{file}</Code>
			</Text>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { gap: 8, paddingVertical: 16 },
});
