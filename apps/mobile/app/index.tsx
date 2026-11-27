import { Stack, useTheme } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { readAppInfo } from "../src/app-info";

/** Placeholder home screen until the server list arrives (phase 4). */
export default function Home() {
	const { colors } = useTheme();
	const info = readAppInfo();
	return (
		<View style={styles.screen}>
			<Stack.Screen options={{ title: info.name }} />
			<Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
				{info.name}
			</Text>
			<Text style={{ color: colors.text }}>Version {info.version}</Text>
			<Text style={{ color: colors.text }}>React Native {info.reactNativeVersion}</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
	title: { fontSize: 28, fontWeight: "600" },
});
