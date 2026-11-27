import { Stack } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { Text } from "@mdxserve/ui/primitives/Text";
import { useSideInsets } from "../src/side-insets";

/** Placeholder for the app's settings until it has some (phase 4: theme). */
export default function Settings() {
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="settings-content"
		>
			<Stack.Screen options={{ title: "Settings" }} />
			<Text paragraph={true}>The theme follows the system setting.</Text>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { paddingVertical: 16 },
});
