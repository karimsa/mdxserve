import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Text } from "@mdxserve/ui/primitives/Text";
import { useServers } from "../../../src/servers/ServersProvider";
import { displayName, type AddressSource, type KnownServer } from "../../../src/servers/store";
import { useSideInsets } from "../../../src/side-insets";

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
			// A scroll view, so the text starts below the translucent header.
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				contentContainerStyle={[styles.screen, sideInsets]}
			>
				<Stack.Screen options={{ title: "Server" }} />
				<Text tone="muted">This server is no longer in the list.</Text>
			</ScrollView>
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
						router.dismissTo("/servers");
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
			{/* The screen is about this one server and its Name field says which, so the header does
			    not repeat the name. */}
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
				className={FIELD}
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
				<View key={address.url} style={styles.address}>
					{/* A field that cannot be changed, so the address can be selected and copied. */}
					<TextInput
						value={address.url}
						editable={false}
						multiline={true}
						scrollEnabled={false}
						accessibilityLabel={`Address ${address.url}`}
						className={FIELD}
					/>
					<Text size="sm" tone="muted">
						{SOURCE_WORDS[address.source]}
					</Text>
				</View>
			))}
			<Text size="sm" tone="muted" paragraph={true}>
				{`mdxserve ${server.version}, ${server.permissions} permissions`}
			</Text>
			<View style={styles.actions}>
				<Pressable
					onPress={confirmRemove}
					accessibilityLabel={`Remove ${displayName(server)}`}
					className="rounded-md bg-status-danger-solid px-4 py-2"
				>
					<Text weight="semibold" className="text-white">
						Remove server
					</Text>
				</Pressable>
			</View>
		</ScrollView>
	);
}

/** The look of the Name field and of each address, which is the same field made read-only. */
const FIELD =
	"rounded-md border border-border-default bg-surface-card px-3 py-2 font-sans text-text-body";

/** Where an address came from, in words. */
const SOURCE_WORDS: Record<AddressSource, string> = {
	manual: "Entered by you",
	qr: "Scanned",
	"tailnet-peer": "Found on your tailnet",
	reported: "Reported by the server",
	"bonjour-lan": "Found on the network",
	"bonjour-tailnet": "Found on the network",
};

const styles = StyleSheet.create({
	screen: { gap: 8, paddingVertical: 16 },
	address: { gap: 4 },
	actions: { flexDirection: "row", marginTop: 16 },
});
