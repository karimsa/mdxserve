import { Stack, useTheme } from "expo-router";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useSideInsets } from "../src/side-insets";

/** Placeholder for the app's settings until it has some (phase 4: theme). */
export default function Settings() {
	const { colors } = useTheme();
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="settings-content"
		>
			<Stack.Screen options={{ title: "Settings" }} />
			<Text style={{ color: colors.text }}>The theme follows the system setting.</Text>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { paddingVertical: 16 },
});
