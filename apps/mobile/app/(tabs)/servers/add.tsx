import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Text } from "@mdxserve/ui/primitives/Text";
import { useServers } from "../../../src/servers/ServersProvider";
import { useSideInsets } from "../../../src/side-insets";

/**
 * Add a server by scanning the code `mdxserve qr` prints, or by typing its address. The app asks
 * it for `getServerInfo` (five seconds at most) and adds it only when it answers as an mdxserve
 * server (C2).
 */
export default function AddServer() {
	const router = useRouter();
	const { loaded, addByAddress } = useServers();
	const [address, setAddress] = useState("");
	const [adding, setAdding] = useState(false);
	const [error, setError] = useState<string | undefined>();
	const sideInsets = useSideInsets();

	async function add() {
		setAdding(true);
		setError(undefined);
		const result = await addByAddress(address);
		setAdding(false);
		if (result.kind === "error") {
			setError(result.message);
			return;
		}
		// Back to the list, also when Add was opened by a link with nothing under it.
		router.dismissTo("/servers");
	}

	const canAdd = loaded && !adding && address.trim().length > 0;
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="add-server-content"
		>
			<Stack.Screen options={{ title: "Add server" }} />
			<View style={styles.scan}>
				<Pressable
					onPress={() => router.push("/servers/scan")}
					disabled={adding}
					className="rounded-md bg-surface-accent-soft px-4 py-2"
				>
					<Text weight="semibold" tone="accent">
						Scan a QR code
					</Text>
				</Pressable>
				<Text size="sm" tone="muted" paragraph={true}>
					Run mdxserve qr on the computer, and scan the code it prints.
				</Text>
			</View>
			<Text weight="semibold">Address</Text>
			<TextInput
				value={address}
				onChangeText={setAddress}
				onSubmitEditing={() => {
					if (canAdd) void add();
				}}
				placeholder="https://your-mac.your-tailnet.ts.net:4040"
				accessibilityLabel="Server address"
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType="url"
				returnKeyType="go"
				textContentType="URL"
				editable={!adding}
				className="rounded-md border border-border-default bg-surface-card px-3 py-2 font-sans text-text-body"
			/>
			<Text size="sm" tone="muted" paragraph={true}>
				The tailnet address that tailscale serve prints, or http:// with the Mac's LAN address and
				port.
			</Text>
			{error === undefined ? null : (
				<Text tone="body" paragraph={true} accessibilityRole="alert">
					{error}
				</Text>
			)}
			<View style={styles.actions}>
				<Pressable
					onPress={() => void add()}
					disabled={!canAdd}
					accessibilityState={{ disabled: !canAdd, busy: adding }}
					className="flex-row items-center gap-2 rounded-md bg-surface-accent-soft px-4 py-2"
				>
					{adding ? <ActivityIndicator size="small" /> : null}
					<Text weight="semibold" tone="accent">
						{adding ? "Checking…" : "Add"}
					</Text>
				</Pressable>
			</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { gap: 8, paddingVertical: 16 },
	actions: { flexDirection: "row", marginTop: 8 },
	scan: { alignItems: "flex-start", gap: 8, marginBottom: 16 },
});
