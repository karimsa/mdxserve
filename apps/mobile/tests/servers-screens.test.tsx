import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import { router } from "expo-router";
import { Alert } from "react-native";
import { Uniwind } from "uniwind";
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
const TAILNET = "https://box.tail1.ts.net:4040";

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

// What each origin mockAnswers; the real probe asks the network.
const mockAnswers = new Map<string, ProbeResult>();
jest.mock("../src/servers/probe", () => ({
	createProbe: () => async (origin: string) =>
		mockAnswers.get(origin) ?? {
			kind: "failed",
			cause: "could not connect (Network request failed)",
		},
}));

const ROUTES = APP_ROUTES;

/** The Servers tab's list; the Library tab is rendered beside it and names servers too. */
function serverList() {
	return within(screen.getByTestId("servers-content"));
}

/** Type an address and press Add once the stored list has loaded (Add is disabled until then). */
async function addAddress(address: string) {
	await fireEvent.changeText(await screen.findByLabelText("Server address"), address);
	await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeEnabled());
	await fireEvent.press(screen.getByRole("button", { name: "Add" }));
}

/**
 * Wait until the stored list passes `check`. It polls storage outside `act`: an async `waitFor`
 * callback overlaps React's act scopes.
 */
async function untilStored(
	check: (servers: Awaited<ReturnType<typeof storedServers>>) => void,
): Promise<void> {
	const deadline = Date.now() + 2000;
	for (;;) {
		try {
			check(await storedServers());
			return;
		} catch (error) {
			if (Date.now() > deadline) throw error;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
}

async function storedServers(): Promise<
	Array<{ id: string; label?: string; addresses: unknown[] }>
> {
	const stored = await AsyncStorage.getItem(SERVERS_KEY);
	return stored === null ? [] : JSON.parse(stored).servers;
}

beforeEach(async () => {
	mockAnswers.clear();
	await AsyncStorage.clear();
});

afterEach(async () => {
	await act(async () => Uniwind.setTheme("light"));
});

const sheet = loadCompiledStylesheet();

describe("the server screens' classes", () => {
	it.each(["light", "dark"])(
		"are all in the compiled stylesheet with usable values (%s)",
		(theme) => {
			const { classes } = resolveTheme(sheet, theme);
			const names = [
				...classesInAppSource("src/servers/ServerRow.tsx", ["STATUS_DOTS"]),
				...classesInAppSource("app/(tabs)/servers/add.tsx"),
				...classesInAppSource("app/(tabs)/servers/[serverId].tsx"),
			];
			expect(names.length).toBeGreaterThan(15);
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

describe.each(["light", "dark"] as const)("the server screens (%s)", (theme) => {
	beforeEach(async () => {
		await act(() => Uniwind.setTheme(theme));
	});

	it("say there are no servers yet", async () => {
		await renderRouter(ROUTES, { initialUrl: "/servers" });
		expect(await serverList().findByText("No servers yet")).toBeOnTheScreen();
	});

	it("add a server that answers, with its tailnet address, and show it reachable (C1)", async () => {
		mockAnswers.set("http://192.168.1.10:4040", { kind: "ok", info: info() });
		mockAnswers.set(TAILNET, { kind: "ok", info: info() });
		await renderRouter(ROUTES, { initialUrl: "/servers/add" });
		await addAddress(" http://192.168.1.10:4040/notes ");
		expect(await serverList().findByText("box")).toBeOnTheScreen();
		expect(screen).toHavePathname("/servers");
		const [server] = await storedServers();
		expect(server.addresses).toEqual([
			expect.objectContaining({ url: "http://192.168.1.10:4040", source: "manual" }),
			expect.objectContaining({ url: TAILNET, source: "reported" }),
		]);
		expect(await serverList().findByText("Reachable at box.tail1.ts.net:4040")).toBeOnTheScreen();
	});

	it("refuse an address that does not answer and say why, adding nothing (C2)", async () => {
		await renderRouter(ROUTES, { initialUrl: "/servers/add" });
		await addAddress("https://nobody.example");
		expect(
			await screen.findByText(
				"No mdxserve server answered at https://nobody.example: could not connect (Network request failed)",
			),
		).toBeOnTheScreen();
		expect(await storedServers()).toEqual([]);
	});
});

describe("a known server", () => {
	async function seed(overrides: Record<string, unknown> = {}) {
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
						addresses: [{ url: TAILNET, source: "manual" }],
						...overrides,
					},
				],
			}),
		);
	}

	it("is listed as unreachable when its address does not answer (R5)", async () => {
		await seed();
		await renderRouter(ROUTES, { initialUrl: "/servers" });
		expect(await serverList().findByText("Unreachable")).toBeOnTheScreen();
	});

	it("is listed as a different server when its address answers with another id", async () => {
		await seed();
		mockAnswers.set(TAILNET, {
			kind: "ok",
			info: info({ id: "0d6f3b1a-8c2e-4f5d-a7b9-1e3c5a7b9d0f" }),
		});
		await renderRouter(ROUTES, { initialUrl: "/servers" });
		expect(
			await serverList().findByText("box.tail1.ts.net:4040 is now a different server"),
		).toBeOnTheScreen();
	});

	it("asks for an app update when its tree schema is newer than the app's", async () => {
		await seed({ treeSchemaVersion: 2 });
		await renderRouter(ROUTES, { initialUrl: "/servers" });
		expect(await serverList().findByText("Update the app to read this server")).toBeOnTheScreen();
	});

	it("is renamed as the name is typed, and back to its own name when emptied (C4)", async () => {
		await seed();
		await renderRouter(ROUTES, { initialUrl: `/servers/${ID}` });
		const field = await screen.findByLabelText("Name for this server");
		await fireEvent.changeText(field, "Studio");
		await untilStored((servers) => expect(servers[0].label).toBe("Studio"));
		await fireEvent.changeText(field, "");
		await untilStored((servers) => expect(servers[0]).not.toHaveProperty("label"));
	});

	it("shows its saved name when its page is the first one opened", async () => {
		await seed({ label: "Studio" });
		await renderRouter(ROUTES, { initialUrl: `/servers/${ID}` });
		expect((await screen.findByLabelText("Name for this server")).props.value).toBe("Studio");
	});

	it("goes back to the saved name, and says so, when the device cannot save a rename", async () => {
		await seed({ label: "Studio" });
		await renderRouter(ROUTES, { initialUrl: `/servers/${ID}` });
		// AsyncStorage's jest stand-in is a jest.fn: fail its next write only.
		jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("disk full"));
		await fireEvent.changeText(await screen.findByLabelText("Name for this server"), "Desk");
		expect(
			await screen.findByText("The change was not saved on this device: Error: disk full"),
		).toBeOnTheScreen();
		expect(screen.getByLabelText("Name for this server").props.value).toBe("Studio");
		expect((await storedServers())[0].label).toBe("Studio");
	});

	it("starts the name again from the saved one on every failed save, even with the same error", async () => {
		await seed({ label: "Studio" });
		await renderRouter(ROUTES, { initialUrl: `/servers/${ID}` });
		for (const attempt of ["Desk", "Den"]) {
			jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("disk full"));
			await fireEvent.changeText(await screen.findByLabelText("Name for this server"), attempt);
			await waitFor(() =>
				expect(screen.getByLabelText("Name for this server").props.value).toBe("Studio"),
			);
		}
		expect((await storedServers())[0].label).toBe("Studio");
	});

	it("keeps a newer rename that is still being written when an earlier write fails", async () => {
		await seed();
		await renderRouter(ROUTES, { initialUrl: `/servers/${ID}` });
		const field = await screen.findByLabelText("Name for this server");
		let failFirst: (error: Error) => void = () => {};
		jest
			.mocked(AsyncStorage.setItem)
			.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => (failFirst = reject)));
		await fireEvent.changeText(field, "D");
		await fireEvent.changeText(field, "Desk");
		await act(async () => failFirst(new Error("disk full")));
		await untilStored((servers) => expect(servers[0].label).toBe("Desk"));
		expect(screen.getByLabelText("Name for this server").props.value).toBe("Desk");
		expect(screen.queryByText(/was not saved/)).toBeNull();
	});

	it("is checked again when an address that answers is added to it", async () => {
		await seed();
		await renderRouter(ROUTES, { initialUrl: "/servers" });
		expect(await serverList().findByText("Unreachable")).toBeOnTheScreen();
		mockAnswers.set("http://192.168.1.10:4040", { kind: "ok", info: info({ tailnetUrls: [] }) });
		await act(() => router.push("/servers/add"));
		await addAddress("http://192.168.1.10:4040");
		expect(await serverList().findByText("Reachable at 192.168.1.10:4040")).toBeOnTheScreen();
	});

	it("says where each of its addresses came from", async () => {
		await seed({
			addresses: [
				{ url: TAILNET, source: "reported" },
				{ url: "http://192.168.1.10:4040", source: "qr" },
				{ url: "http://10.0.0.5:4040", source: "manual" },
			],
		});
		await renderRouter(ROUTES, { initialUrl: `/servers/${ID}` });
		const details = within(await screen.findByTestId("server-details-content"));
		expect(details.getByText("Reported by the server")).toBeOnTheScreen();
		expect(details.getByText("Scanned")).toBeOnTheScreen();
		expect(details.getByText("Entered by you")).toBeOnTheScreen();
	});

	it("shows each address in a field that cannot be changed, and no server name in the header", async () => {
		await seed({ addresses: [{ url: TAILNET, source: "manual" }] });
		await renderRouter(ROUTES, { initialUrl: `/servers/${ID}` });
		const details = within(await screen.findByTestId("server-details-content"));
		const field = details.getByLabelText(`Address ${TAILNET}`);
		expect(field.props).toMatchObject({ value: TAILNET, editable: false });
		expect(screen.queryByTestId("header-server-name")).toBeNull();
	});

	it("is removed after the reader confirms (C4)", async () => {
		await seed();
		const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
			buttons?.find((button) => button.text === "Remove")?.onPress?.();
		});
		await renderRouter(ROUTES, { initialUrl: `/servers/${ID}` });
		await fireEvent.press(await screen.findByLabelText("Remove box"));
		await untilStored((servers) => expect(servers).toEqual([]));
		alert.mockRestore();
	});
});
