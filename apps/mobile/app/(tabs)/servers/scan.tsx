import { parseQrPayload } from "@mdxserve/shared/discovery";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Stack, useIsFocused, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, ScrollView, StyleSheet, View } from "react-native";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { Text } from "@mdxserve/ui/primitives/Text";
import { CandidateCard } from "../../../src/servers/CandidateCard";
import { checkCandidate, type ConfirmedCandidate } from "../../../src/servers/candidate";
import { useServers } from "../../../src/servers/ServersProvider";
import { useSideInsets } from "../../../src/side-insets";

/** How long "That code is not an mdxserve address." stays up while scanning goes on (S2). */
const NOTICE_MS = 3000;

type Stage =
	| { kind: "scanning"; notice: string | undefined }
	| { kind: "checking"; host: string }
	| { kind: "confirmed"; check: ConfirmedCandidate }
	| { kind: "failed"; message: string };

const SCANNING: Stage = { kind: "scanning", notice: undefined };

/**
 * Add a server by scanning the code `mdxserve qr` prints (D10). The code names an address and
 * the server's id; the app asks that address for `getServerInfo` and offers to add the server
 * only when it answers with that id (I1). Frames never leave the device: only the decoded text
 * is used.
 */
export default function ScanServer() {
	const router = useRouter();
	const { probe, servers, addConfirmed } = useServers();
	const [permission, requestPermission, getPermission] = useCameraPermissions();
	// The camera runs only while this screen is the one on view: another tab keeps it mounted.
	const focused = useIsFocused();
	const [stage, setStage] = useState<Stage>(SCANNING);
	const [cameraError, setCameraError] = useState<string | undefined>();
	const lastCode = useRef<string | undefined>(undefined);
	const sideInsets = useSideInsets();

	// The system asks the first time; after a refusal iOS never asks again.
	const canAsk = permission !== null && !permission.granted && permission.canAskAgain;
	useEffect(() => {
		if (canAsk) void requestPermission();
	}, [canAsk, requestPermission]);

	// Back from Settings, where the reader may have allowed the camera: read the permission again.
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (status) => {
			if (status === "active") void getPermission();
		});
		return () => subscription.remove();
	}, [getPermission]);

	useEffect(() => {
		if (stage.kind !== "scanning" || stage.notice === undefined) return;
		const timer = setTimeout(() => setStage(SCANNING), NOTICE_MS);
		return () => clearTimeout(timer);
	}, [stage]);

	async function scanned({ data }: BarcodeScanningResult) {
		// A code still in view is read many times a second.
		if (data === lastCode.current) return;
		lastCode.current = data;
		const payload = parseQrPayload(data);
		if (payload.kind === "error") {
			setStage({ kind: "scanning", notice: payload.message });
			return;
		}
		const host = new URL(payload.origin).host;
		setStage({ kind: "checking", host });
		const check = await checkCandidate(
			{ origins: [{ url: payload.origin, source: "qr" }], expectedId: payload.serverId },
			probe,
		);
		if (check.kind === "confirmed") {
			setStage({ kind: "confirmed", check });
		} else if (check.kind === "different") {
			setStage({
				kind: "failed",
				message: `${host} answered as a different server than this code was made for.`,
			});
		} else {
			const cause = check.causes[0]?.cause ?? "no answer";
			const onTailnet = new URL(payload.origin).hostname.endsWith(".ts.net");
			const tailscale = onTailnet ? " Turn on Tailscale on this phone." : "";
			setStage({
				kind: "failed",
				message: `No mdxserve server answered at ${host}: ${cause}.${tailscale}`,
			});
		}
	}

	function scanAgain() {
		lastCode.current = undefined;
		setStage(SCANNING);
	}

	function add(check: ConfirmedCandidate) {
		const result = addConfirmed(check);
		if (result.kind === "error") {
			setStage({ kind: "failed", message: result.message });
			return;
		}
		router.dismissTo("/servers");
	}

	function body() {
		if (permission === null || canAsk) return <ActivityIndicator />;
		if (!permission.granted) {
			return (
				<>
					<Text paragraph={true}>
						mdxserve cannot use the camera. Allow it in Settings to scan a code, or type the
						address.
					</Text>
					<View style={styles.actions}>
						<Pressable
							onPress={() => void Linking.openSettings()}
							className="rounded-md bg-surface-accent-soft px-4 py-2"
						>
							<Text weight="semibold" tone="accent">
								Open Settings
							</Text>
						</Pressable>
						<Pressable onPress={() => router.back()} className="rounded-md px-4 py-2">
							<Text weight="semibold">Back</Text>
						</Pressable>
					</View>
				</>
			);
		}
		if (cameraError !== undefined) {
			return <Text paragraph={true}>{`The camera could not start: ${cameraError}`}</Text>;
		}
		if (stage.kind === "confirmed") {
			const saved = servers.find((server) => server.id === stage.check.info.id);
			return (
				<>
					<CandidateCard check={stage.check} saved={saved} onAdd={() => add(stage.check)} />
					<View style={styles.actions}>
						<Pressable onPress={scanAgain} className="rounded-md px-4 py-2">
							<Text weight="semibold">Scan again</Text>
						</Pressable>
					</View>
				</>
			);
		}
		if (stage.kind === "failed") {
			return (
				<>
					<Text paragraph={true} accessibilityRole="alert">
						{stage.message}
					</Text>
					<View style={styles.actions}>
						<Pressable onPress={scanAgain} className="rounded-md bg-surface-accent-soft px-4 py-2">
							<Text weight="semibold" tone="accent">
								Scan again
							</Text>
						</Pressable>
					</View>
				</>
			);
		}
		return (
			<>
				<View style={styles.camera} className="rounded-md bg-surface-inverse">
					{focused ? (
						<CameraView
							style={StyleSheet.absoluteFill}
							facing="back"
							barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
							// No codes are read while an address is being checked.
							onBarcodeScanned={
								stage.kind === "scanning" ? (result) => void scanned(result) : undefined
							}
							onMountError={(error) => setCameraError(error.message)}
							testID="qr-camera"
						/>
					) : null}
				</View>
				{stage.kind === "checking" ? (
					<View style={styles.actions}>
						<ActivityIndicator size="small" />
						<Text tone="muted">{`Checking ${stage.host}…`}</Text>
					</View>
				) : (
					<Text
						tone={stage.notice === undefined ? "muted" : "body"}
						accessibilityRole={stage.notice === undefined ? undefined : "alert"}
					>
						{stage.notice ?? "Point the camera at the code mdxserve qr prints."}
					</Text>
				)}
			</>
		);
	}

	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			testID="scan-server-content"
		>
			<Stack.Screen options={{ title: "Scan a QR code" }} />
			<View style={styles.column}>{body()}</View>
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { paddingVertical: 16 },
	// Capped and centred, so an unfolded display does not get a camera as wide as itself.
	column: { gap: 12, width: "100%", maxWidth: 640, alignSelf: "center" },
	camera: { width: "100%", aspectRatio: 1, overflow: "hidden" },
	actions: { flexDirection: "row", alignItems: "center", gap: 8 },
});
