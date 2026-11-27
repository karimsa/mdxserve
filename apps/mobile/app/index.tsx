import { Stack, useRouter, useTheme } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Badge from "@mdxserve/ui/builtins/Badge";
import Callout from "@mdxserve/ui/builtins/Callout";
import Tabs from "@mdxserve/ui/builtins/Tabs";
import { Wordmark } from "@mdxserve/ui/brand/Wordmark";
import { readAppInfo } from "../src/app-info";
import { useSideInsets } from "../src/side-insets";

const TABS = [
	{ id: "sample>overview", value: "overview", label: "Overview" },
	{ id: "sample>details", value: "details", label: "Details" },
];

/** The header's title: the wordmark the web client's top bar shows. */
function HeaderWordmark() {
	return <Wordmark />;
}

/**
 * Placeholder home screen until the server list arrives (phase 4). Below the app's details it
 * shows the builtins the app shares with the web client (@mdxserve/ui).
 */
export default function Home() {
	const { colors } = useTheme();
	const info = readAppInfo();
	const [tab, setTab] = useState("overview");
	const router = useRouter();
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="home-content"
		>
			<Stack.Screen options={{ title: info.name, headerTitle: HeaderWordmark }} />
			{/* A native bar item with an icon: iOS puts it in the top bar, or in the vertical bar
			    beside the content when a folded display draws one. */}
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Button
					icon="gearshape"
					accessibilityLabel="Settings"
					onPress={() => router.push("/settings")}
				/>
			</Stack.Toolbar>
			<Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
				{info.name}
			</Text>
			<Text style={{ color: colors.text }}>Version {info.version}</Text>
			<Text style={{ color: colors.text }}>React Native {info.reactNativeVersion}</Text>
			<View style={styles.samples}>
				<View style={styles.row}>
					<Badge tone="ok" variant="soft" dot={true}>
						Online
					</Badge>
					<Badge tone="warn" variant="solid" dot={false}>
						Degraded
					</Badge>
					<Badge tone="teal" variant="outline" dot={false}>
						Shared
					</Badge>
				</View>
				<Callout tone="tip" title="From @mdxserve/ui">
					<Text className="text-text-body">The web client renders this same component.</Text>
				</Callout>
				<Tabs
					id="sample"
					selected={tab}
					onSelect={setTab}
					tabs={TABS.map((entry) => ({
						...entry,
						content: <Text className="text-text-body">{`The ${entry.label} panel.`}</Text>,
					}))}
				/>
			</View>
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
	title: { fontSize: 28, fontWeight: "600" },
	samples: { alignSelf: "stretch", gap: 16, marginTop: 24 },
	row: { flexDirection: "row", gap: 8 },
});
