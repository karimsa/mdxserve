import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Code, Text } from "@mdxserve/ui/primitives/Text";
import { readAppInfo } from "../../../src/app-info";
import { useSideInsets } from "../../../src/side-insets";

/** The app's settings (the theme follows the system for now), its version, and the gallery. */
export default function Settings() {
	const info = readAppInfo();
	const router = useRouter();
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="settings-content"
		>
			<Stack.Screen options={{ title: "Settings" }} />
			<Text paragraph={true}>The theme follows the system setting.</Text>
			<Pressable
				onPress={() => router.push("/gallery")}
				accessibilityLabel="Component gallery"
				className="flex-row items-center gap-3 border-b border-border-subtle py-3"
			>
				<View style={styles.grow}>
					<Text weight="semibold">Component gallery</Text>
					<Text size="sm" tone="muted">
						The components the app shares with the web client
					</Text>
				</View>
				<Icon name="chevron-right" size="sm" className="text-text-subtle" />
			</Pressable>
			<View style={styles.about}>
				<Text tone="muted">
					{info.name} <Code>{info.version}</Code>
				</Text>
				<Text tone="muted">
					React Native <Code>{info.reactNativeVersion}</Code>
				</Text>
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { gap: 8, paddingVertical: 16 },
	grow: { flex: 1 },
	about: { gap: 4, marginTop: 16 },
});
