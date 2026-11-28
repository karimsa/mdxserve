import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { Linking } from "react-native";
import { Uniwind } from "uniwind";
import { buildQrPayload } from "@mdxserve/shared/discovery";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import { APP_ROUTES } from "./app-routes";
import type { ProbeResult } from "../src/servers/connection";
import { SERVERS_KEY } from "../src/servers/store";
import { loadCompiledStylesheet, resolveTheme, unusable } from "./stylesheet/analyze.js";
import { classesInAppSource } from "./stylesheet/source-classes.js";

jest.mock("expo-constants", () => ({
	__esModule: true,
	default: { expoConfig: jest.requireActual<{ default: unknown }>("../app.config").default },
}));

const ID = "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e";
const OTHER = "0d6f3b1a-8c2e-4f5d-a7b9-1e3c5a7b9d0f";
const TAILNET = "https://box.tail1.ts.net:4040";
const LAN = "http://192.168.1.10:4040";

function info(overrides: Partial<ServerInfo> = {}): ServerInfo {
	return {
		id: ID,
		name: "box",
		version: "0.7.0",
		permissions: "full",
		mermaidVersion: "10.9.8",
		treeSchemaVersion: 1,
		tailnetUrls: [TAILNET],
		...overrides,
	};
}

const mockAnswers = new Map<string, ProbeResult>();
jest.mock("../src/servers/probe", () => ({
	createProbe: () => async (origin: string) =>
		mockAnswers.get(origin) ?? {
			kind: "failed",
			cause: "could not connect (Network request failed)",
		},
}));

/** The camera: a permission the test sets, and the scan handler the screen last gave it. */
const mockCamera: {
	permission: { granted: boolean; canAskAgain: boolean } | null;
	request: jest.Mock<() => Promise<void>>;
	onScan: ((result: { data: string }) => void) | undefined;
} = { permission: null, request: jest.fn(async () => {}), onScan: undefined };

jest.mock("expo-camera", () => {
	const { createElement } = jest.requireActual<typeof import("react")>("react");
	const { View } = jest.requireActual<typeof import("react-native")>("react-native");
	return {
		useCameraPermissions: () => [mockCamera.permission, mockCamera.request],
		CameraView: (props: {
			testID?: string;
			onBarcodeScanned?: (result: { data: string }) => void;
		}) => {
			mockCamera.onScan = props.onBarcodeScanned;
			return createElement(View, { testID: props.testID });
		},
	};
});

async function scan(data: string) {
	await screen.findByTestId("qr-camera");
	await act(async () => mockCamera.onScan?.({ data }));
}

async function storedServers(): Promise<
	Array<{ id: string; addresses: Array<{ url: string; source: string }> }>
> {
	const stored = await AsyncStorage.getItem(SERVERS_KEY);
	return stored === null ? [] : JSON.parse(stored).servers;
}

beforeEach(async () => {
	mockAnswers.clear();
	mockCamera.permission = { granted: true, canAskAgain: true };
	mockCamera.request.mockClear();
	mockCamera.onScan = undefined;
	await AsyncStorage.clear();
});

afterEach(async () => {
	await act(async () => Uniwind.setTheme("light"));
});

const sheet = loadCompiledStylesheet();

describe("the scan screen's classes", () => {
	it.each(["light", "dark"])(
		"are all in the compiled stylesheet with usable values (%s)",
		(theme) => {
			const { classes } = resolveTheme(sheet, theme);
			const names = [
				...classesInAppSource("app/(tabs)/servers/scan.tsx"),
				...classesInAppSource("src/servers/CandidateCard.tsx"),
			];
			expect(names.length).toBeGreaterThan(8);
			expect(names.filter((name) => !(name in classes))).toEqual([]);
			const problems = names.flatMap((name) =>
				Object.entries(classes[name]).flatMap(([property, value]) => {
					const why = unusable(value);
					return why ? [`${name} ${property}: ${why}`] : [];
				}),
			);
			expect(problems).toEqual([]);
		},
	);
});

describe.each(["light", "dark"] as const)("scanning a QR code (%s)", (theme) => {
	beforeEach(async () => {
		await act(() => Uniwind.setTheme(theme));
	});

	it("opens from Add server", async () => {
		await renderRouter(APP_ROUTES, { initialUrl: "/servers/add" });
		await fireEvent.press(await screen.findByRole("button", { name: "Scan a QR code" }));
		expect(await screen.findByTestId("qr-camera")).toBeOnTheScreen();
		expect(screen).toHavePathname("/servers/scan");
	});

	it("asks for the camera the first time", async () => {
		mockCamera.permission = { granted: false, canAskAgain: true };
		await renderRouter(APP_ROUTES, { initialUrl: "/servers/scan" });
		await act(async () => {});
		expect(mockCamera.request).toHaveBeenCalled();
	});

	it("says why the camera cannot be used, with a way to open Settings (S1)", async () => {
		mockCamera.permission = { granted: false, canAskAgain: false };
		const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
		await renderRouter(APP_ROUTES, { initialUrl: "/servers/scan" });
		expect(
			await screen.findByText(
				"mdxserve cannot use the camera. Allow it in Settings to scan a code, or type the address.",
			),
		).toBeOnTheScreen();
		await fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
		expect(openSettings).toHaveBeenCalled();
		expect(screen.queryByTestId("qr-camera")).toBeNull();
		openSettings.mockRestore();
	});

	it("adds nothing for a code that is not an address, and keeps scanning (S2)", async () => {
		await renderRouter(APP_ROUTES, { initialUrl: "/servers/scan" });
		await scan("WIFI:S:home;T:WPA;P:secret;;");
		expect(await screen.findByText("That code is not an mdxserve address.")).toBeOnTheScreen();
		expect(screen.getByTestId("qr-camera")).toBeOnTheScreen();
		expect(await storedServers()).toEqual([]);
	});

	it("shows the server the code names and adds it with a tap (D10, I4)", async () => {
		mockAnswers.set(LAN, { kind: "ok", info: info() });
		await renderRouter(APP_ROUTES, { initialUrl: "/servers/scan" });
		await scan(buildQrPayload({ origin: LAN, serverId: ID }));
		expect(await screen.findByText("192.168.1.10:4040")).toBeOnTheScreen();
		expect(screen.getByText("mdxserve 0.7.0, full permissions")).toBeOnTheScreen();
		expect(await storedServers()).toEqual([]);
		await fireEvent.press(screen.getByRole("button", { name: "Add" }));
		expect(screen).toHavePathname("/servers");
		const deadline = Date.now() + 2000;
		while ((await storedServers()).length === 0 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		const [server] = await storedServers();
		expect(server.id).toBe(ID);
		expect(server.addresses).toEqual([
			expect.objectContaining({ url: LAN, source: "qr" }),
			expect.objectContaining({ url: TAILNET, source: "reported" }),
		]);
	});

	it("refuses an address that answers as another server than the code names (I1)", async () => {
		mockAnswers.set(LAN, { kind: "ok", info: info({ id: OTHER }) });
		await renderRouter(APP_ROUTES, { initialUrl: "/servers/scan" });
		await scan(buildQrPayload({ origin: LAN, serverId: ID }));
		expect(
			await screen.findByText(
				"192.168.1.10:4040 answered as a different server than this code was made for.",
			),
		).toBeOnTheScreen();
		expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
		await fireEvent.press(screen.getByRole("button", { name: "Scan again" }));
		expect(await screen.findByTestId("qr-camera")).toBeOnTheScreen();
	});

	it("says why a tailnet address did not answer", async () => {
		await renderRouter(APP_ROUTES, { initialUrl: "/servers/scan" });
		await scan(buildQrPayload({ origin: TAILNET, serverId: ID }));
		expect(
			await screen.findByText(
				"No mdxserve server answered at box.tail1.ts.net:4040: could not connect (Network request failed). Turn on Tailscale on this phone.",
			),
		).toBeOnTheScreen();
	});

	it("says Added for a server already saved at that address", async () => {
		mockAnswers.set(LAN, { kind: "ok", info: info() });
		await AsyncStorage.setItem(
			SERVERS_KEY,
			JSON.stringify({
				servers: [
					{
						id: ID,
						name: "box",
						version: "0.7.0",
						permissions: "full",
						treeSchemaVersion: 1,
						addedAt: "2026-11-27T12:00:00.000Z",
						addresses: [{ url: LAN, source: "manual" }],
					},
				],
			}),
		);
		await renderRouter(APP_ROUTES, { initialUrl: "/servers/scan" });
		await scan(buildQrPayload({ origin: LAN, serverId: ID }));
		expect(await screen.findByText("Added")).toBeOnTheScreen();
		expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
	});
});
