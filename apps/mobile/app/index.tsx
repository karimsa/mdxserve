import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";
import { Wordmark } from "@mdxserve/ui/brand/Wordmark";
import { Code, Heading, Link, Text } from "@mdxserve/ui/primitives/Text";
import { readAppInfo } from "../src/app-info";
import { useSideInsets } from "../src/side-insets";

/** The header's title: the wordmark the web client's top bar shows. */
function HeaderWordmark() {
	return <Wordmark />;
}

/**
 * Placeholder home screen until the server list arrives (phase 4): the app's details, and the
 * way to the gallery of the components it shares with the web client.
 */
export default function Home() {
	const info = readAppInfo();
	const router = useRouter();
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="home-content"
		>
			<Stack.Screen options={{ title: info.name, headerTitle: HeaderWordmark }} />
			{/* Native bar items with an icon: iOS puts them in the top bar, or in the vertical bar
			    beside the content when a folded display draws one. */}
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Button
					icon="server.rack"
					accessibilityLabel="Servers"
					onPress={() => router.push("/servers")}
				/>
				<Stack.Toolbar.Button
					icon="square.grid.2x2"
					accessibilityLabel="Gallery"
					onPress={() => router.push("/gallery")}
				/>
				<Stack.Toolbar.Button
					icon="gearshape"
					accessibilityLabel="Settings"
					onPress={() => router.push("/settings")}
				/>
			</Stack.Toolbar>
			<Heading level={1}>{info.name}</Heading>
			<Text tone="muted">
				Version <Code>{info.version}</Code>
			</Text>
			<Text tone="muted">
				React Native <Code>{info.reactNativeVersion}</Code>
			</Text>
			<Text>
				<Link href="/gallery" onPress={() => router.push("/gallery")}>
					Component gallery
				</Link>
			</Text>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: {
		flexGrow: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
		paddingVertical: 16,
	},
});
