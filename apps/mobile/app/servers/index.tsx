import { Stack, useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@mdxserve/ui/primitives/Text";
import { ServerRow } from "../../src/servers/ServerRow";
import { useServers } from "../../src/servers/ServersProvider";
import { useSideInsets } from "../../src/side-insets";

/** The reader's servers: each one's state, and the way to add, rename and remove them (C1, C4). */
export default function Servers() {
	const router = useRouter();
	const { loaded, servers, problem } = useServers();
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="servers-content"
		>
			<Stack.Screen options={{ title: "Servers" }} />
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Button
					icon="plus"
					accessibilityLabel="Add server"
					onPress={() => router.push("/servers/add")}
				/>
			</Stack.Toolbar>
			{problem === undefined ? null : (
				<Text tone="body" paragraph={true}>
					{problem}
				</Text>
			)}
			{loaded && servers.length === 0 ? (
				<View style={styles.empty}>
					<Text weight="semibold">No servers yet</Text>
					<Text tone="muted" paragraph={true}>
						Add one by its address, for example https://your-mac.your-tailnet.ts.net:4040.
					</Text>
				</View>
			) : null}
			{servers.map((server) => (
				<ServerRow
					key={server.id}
					server={server}
					onPress={() =>
						router.push({ pathname: "/servers/[serverId]", params: { serverId: server.id } })
					}
				/>
			))}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { paddingVertical: 16 },
	empty: { gap: 4, paddingVertical: 24 },
});
