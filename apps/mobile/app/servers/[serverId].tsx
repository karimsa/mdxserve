import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Code, Text } from "@mdxserve/ui/primitives/Text";
import { useServers } from "../../src/servers/ServersProvider";
import { displayName, type KnownServer } from "../../src/servers/store";
import { useSideInsets } from "../../src/side-insets";

/**
 * One server: the reader's name for it, which saves as it is typed, its addresses, and Remove
 * (C4).
 */
export default function ServerDetails() {
	const { serverId } = useLocalSearchParams<{ serverId: string }>();
	const { loaded, servers, revertCount } = useServers();
	const server = servers.find((candidate) => candidate.id === serverId);
	const sideInsets = useSideInsets();

	if (!loaded) return <Stack.Screen options={{ title: "Server" }} />;
	if (!server) {
		return (
			<View style={[styles.screen, sideInsets]}>
				<Stack.Screen options={{ title: "Server" }} />
				<Text tone="muted">This server is no longer in the list.</Text>
			</View>
		);
	}
	// A save that failed puts the stored name back; start the field again from it.
	return <ServerForm key={`${server.id}:${revertCount}`} server={server} />;
}

function ServerForm({ server }: { server: KnownServer }) {
	const router = useRouter();
	const { problem, saving, rename, remove } = useServers();
	const [label, setLabel] = useState(server.label ?? "");
	const sideInsets = useSideInsets();

	function confirmRemove() {
		Alert.alert(
			`Remove ${displayName(server)}?`,
			"The app forgets the server and its addresses. You can add it again by its address.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Remove",
					style: "destructive",
					onPress: () => {
						remove(server.id);
						if (router.canGoBack()) router.back();
						else router.replace("/servers");
					},
				},
			],
		);
	}

	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="server-details-content"
		>
			<Stack.Screen options={{ title: displayName(server) }} />
			<Text weight="semibold">Name</Text>
			<TextInput
				value={label}
				onChangeText={(text) => {
					setLabel(text);
					rename(server.id, text);
				}}
				placeholder={server.name}
				accessibilityLabel="Name for this server"
				maxLength={63}
				autoCorrect={false}
				returnKeyType="done"
				className="rounded-md border border-border-default bg-surface-card px-3 py-2 font-sans text-text-body"
			/>
			<Text size="sm" tone="muted" paragraph={true}>
				{saving ? "Saving…" : `Leave it empty to use the server's own name, ${server.name}.`}
			</Text>
			{problem === undefined ? null : (
				<Text paragraph={true} accessibilityRole="alert">
					{problem}
				</Text>
			)}
			<Text weight="semibold" className="mt-4">
				Addresses
			</Text>
			{server.addresses.map((address) => (
				<Text key={address.url}>
					<Code>{address.url}</Code>
				</Text>
			))}
			<Text size="sm" tone="muted" paragraph={true}>
				{`mdxserve ${server.version}, ${server.permissions} permissions`}
			</Text>
			<View style={styles.actions}>
				<Pressable
					onPress={confirmRemove}
					accessibilityLabel={`Remove ${displayName(server)}`}
					className="rounded-md bg-status-danger-bg px-4 py-2"
				>
					<Text weight="semibold">Remove server</Text>
				</Pressable>
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { gap: 8, paddingVertical: 16 },
	actions: { flexDirection: "row", marginTop: 16 },
});
