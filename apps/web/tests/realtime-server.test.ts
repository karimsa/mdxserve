import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REALTIME_PATH, SERVER_EVENTS } from "@mdxserve/shared/realtime";
import { watch } from "chokidar";
import { isWatchIgnored, signalFileChanges } from "@karimsa/mdxserve/src/http/watch-signals";
import { MAX_JOINED_PATHS } from "@karimsa/mdxserve/src/realtime/server";
import { TailnetHosts } from "@karimsa/mdxserve/src/tailscale/tailnet-hosts";
import { io as connect } from "socket.io-client";
import {
	createRealtimeClient,
	REFUSED_RETRY_DELAY_MS,
	type RealtimeSocket,
} from "../src/realtime.js";
import {
	connected,
	delay,
	join,
	record,
	startHarness,
	type Harness,
} from "@karimsa/mdxserve/tests/helpers/realtime";

let harness: Harness | undefined;

afterEach(async () => {
	await harness?.close();
	harness = undefined;
});

/** The status of an engine.io polling handshake sent with these headers. */
function handshakeStatus(port: number, headers: Record<string, string>): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = http.get(
			{
				host: "127.0.0.1",
				port,
				path: `${REALTIME_PATH}/?EIO=4&transport=polling`,
				headers,
			},
			(res) => {
				res.resume();
				resolve(res.statusCode ?? 0);
			},
		);
		req.on("error", reject);
	});
}

describe("attachRealtime handshake", () => {
	it("accepts a handshake whose Host names this machine", async () => {
		harness = await startHarness();
		expect(await handshakeStatus(harness.port, { host: `127.0.0.1:${harness.port}` })).toBe(200);
		expect(await handshakeStatus(harness.port, { host: `localhost:${harness.port}` })).toBe(200);
	});

	it("in restricted mode, accepts a server name with a matching Origin and nothing else", async () => {
		harness = await startHarness("restricted");
		const host = `mybox.local:${harness.port}`;
		expect(await handshakeStatus(harness.port, { host, origin: `http://${host}` })).toBe(200);
		expect(await handshakeStatus(harness.port, { host })).toBe(200);
		expect(await handshakeStatus(harness.port, { host, origin: "http://attacker.example" })).toBe(
			403,
		);
		expect(await handshakeStatus(harness.port, { host, origin: "null" })).toBe(403);

		// Reached by name, the reader still only joins public documents.
		const socket = harness.client({ host, origin: `http://${host}` });
		await connected(socket);
		expect(await join(socket, { path: path.join(harness.root, ".hidden", "secret.md") })).toEqual({
			ok: false,
		});
		expect(await join(socket, { path: path.join(harness.root, "alias.md") })).toEqual({
			ok: false,
		});
		expect(await join(socket, { path: "doc.md" })).toEqual({ ok: true });
	});

	it("refuses a handshake with a foreign Host in full mode, as a DNS-rebinding page would send", async () => {
		harness = await startHarness("full");
		expect(await handshakeStatus(harness.port, { host: `attacker.example:${harness.port}` })).toBe(
			403,
		);
		await expect(
			connected(harness.client({ host: `attacker.example:${harness.port}` })),
		).rejects.toThrow();
	});

	it("refuses a handshake from another origin", async () => {
		harness = await startHarness();
		expect(
			await handshakeStatus(harness.port, {
				host: `127.0.0.1:${harness.port}`,
				origin: "http://attacker.example",
			}),
		).toBe(403);
		await expect(
			connected(harness.client({ origin: "http://attacker.example" })),
		).rejects.toThrow();
		await expect(connected(harness.client({ origin: "null" }))).rejects.toThrow();
	});

	it("makes the browser client slow its retries for a refusal, not for a server that is down", async () => {
		harness = await startHarness();
		// The browser client's default transport (polling first), as a page would connect.
		const refused = connect(`http://127.0.0.1:${harness.port}`, {
			path: REALTIME_PATH,
			forceNew: true,
			extraHeaders: { origin: "http://attacker.example" },
		});
		const down = connect("http://127.0.0.1:1", { path: REALTIME_PATH, forceNew: true });
		try {
			createRealtimeClient(refused as unknown as RealtimeSocket);
			createRealtimeClient(down as unknown as RealtimeSocket);
			await Promise.all(
				[refused, down].map(
					(socket) => new Promise((resolve) => socket.once("connect_error", resolve)),
				),
			);
			expect(refused.io.reconnectionDelay()).toBe(REFUSED_RETRY_DELAY_MS);
			expect(down.io.reconnectionDelay()).not.toBe(REFUSED_RETRY_DELAY_MS);
		} finally {
			refused.close();
			down.close();
		}
	});

	it("accepts a same-origin websocket", async () => {
		harness = await startHarness();
		await connected(harness.client({ origin: `http://127.0.0.1:${harness.port}` }));
	});

	it("leaves requests outside its path to the http server's own handler", async () => {
		harness = await startHarness();
		const status = await new Promise<number>((resolve, reject) => {
			http
				.get({ host: "127.0.0.1", port: harness?.port, path: "/somewhere" }, (res) => {
					res.resume();
					resolve(res.statusCode ?? 0);
				})
				.on("error", reject);
		});
		expect(status).toBe(404);
	});
});

describe("attachRealtime handshake through tailscale serve", () => {
	const name = "box.tail1234.ts.net";

	/** A TailnetHosts whose detection reports `hosts()` and counts its calls. */
	function tailnet(hosts: () => string[]) {
		const state = { calls: 0 };
		const source = new TailnetHosts(async () => {
			state.calls += 1;
			return {
				kind: "running",
				cli: "tailscale",
				dnsName: name,
				addresses: hosts().map((host) => ({ host, url: `https://${host}/`, funnel: false })),
				unsupportedPaths: [],
				suggestedHttpsPort: 4040,
			};
		});
		return { source, state };
	}

	it("S1: accepts a detected tailnet Host in full mode, in both header shapes", async () => {
		const { source } = tailnet(() => [name, `${name}:8443`]);
		await source.detect();
		harness = await startHarness("full", source);
		expect(await handshakeStatus(harness.port, { host: name, origin: `https://${name}` })).toBe(
			200,
		);
		expect(
			await handshakeStatus(harness.port, { host: `${name}:8443`, origin: `https://${name}:8443` }),
		).toBe(200);
		// If the proxy rewrote Host to its loopback target, it is accepted as before.
		expect(await handshakeStatus(harness.port, { host: `127.0.0.1:${harness.port}` })).toBe(200);
		const socket = harness.client({ host: name, origin: `https://${name}` });
		await connected(socket);
		expect(await join(socket, { path: "doc.md" })).toEqual({ ok: true });
	});

	it("S2: refuses an unknown Host, and one the tailnet set has under another port", async () => {
		const { source } = tailnet(() => [name]);
		await source.detect();
		harness = await startHarness("full", source);
		expect(await handshakeStatus(harness.port, { host: "other.tail1234.ts.net" })).toBe(403);
		expect(await handshakeStatus(harness.port, { host: `${name}:9999` })).toBe(403);
		expect(
			await handshakeStatus(harness.port, { host: name, origin: "https://attacker.example" }),
		).toBe(403);
	});

	it("S4: an entry added after startup is refused, and no handshake runs the CLI", async () => {
		let published: string[] = [];
		const { source, state } = tailnet(() => published);
		await source.detect();
		harness = await startHarness("full", source);

		published = [name];
		expect(await handshakeStatus(harness.port, { host: name })).toBe(403);
		expect(await handshakeStatus(harness.port, { host: "attacker.example" })).toBe(403);
		expect(state.calls).toBe(1);
	});
});

describe("attachRealtime join", () => {
	it("acknowledges a join for a document getDocument would serve", async () => {
		harness = await startHarness();
		const socket = harness.client();
		await connected(socket);
		expect(await join(socket, { path: path.join(harness.root, "doc.md") })).toEqual({ ok: true });
		expect(await join(socket, { path: "other.md" })).toEqual({ ok: true });
	});

	it("refuses a join for a path outside every root", async () => {
		harness = await startHarness();
		const socket = harness.client();
		await connected(socket);
		expect(await join(socket, { path: path.join(harness.outside, "out.md") })).toEqual({
			ok: false,
		});
		expect(await join(socket, { path: path.join(harness.root, "..", "x.md") })).toEqual({
			ok: false,
		});
	});

	it("refuses a join for a hidden path in restricted mode", async () => {
		harness = await startHarness("restricted");
		const socket = harness.client();
		await connected(socket);
		expect(await join(socket, { path: path.join(harness.root, ".hidden", "secret.md") })).toEqual({
			ok: false,
		});
		// A public name that links to a hidden file is refused to a restricted
		// reader, as getDocument refuses it.
		expect(await join(socket, { path: path.join(harness.root, "alias.md") })).toEqual({
			ok: false,
		});
		expect(await join(socket, { path: path.join(harness.root, "doc.md") })).toEqual({ ok: true });
	});

	it("allows the same alias in full mode, as getDocument does", async () => {
		harness = await startHarness("full");
		const socket = harness.client();
		await connected(socket);
		expect(await join(socket, { path: path.join(harness.root, "alias.md") })).toEqual({ ok: true });
	});

	it(`caps one connection at ${MAX_JOINED_PATHS} joined paths`, async () => {
		harness = await startHarness();
		const { root } = harness;
		const socket = harness.client();
		await connected(socket);
		// Distinct strings that all resolve to the same document.
		const spellings = Array.from(
			{ length: MAX_JOINED_PATHS + 1 },
			(_, index) => `${root}/${"./".repeat(index)}doc.md`,
		);
		for (const spelling of spellings.slice(0, MAX_JOINED_PATHS)) {
			expect(await join(socket, { path: spelling })).toEqual({ ok: true });
		}
		const extra = spellings[MAX_JOINED_PATHS];
		expect(await join(socket, { path: extra })).toEqual({ ok: false });
		// A path already joined may be joined again, and a leave frees a slot.
		expect(await join(socket, { path: spellings[0] })).toEqual({ ok: true });
		await socket.timeout(2000).emitWithAck("leave", { path: spellings[0] });
		expect(await join(socket, { path: extra })).toEqual({ ok: true });
	});

	it("refuses a malformed join payload", async () => {
		harness = await startHarness();
		const socket = harness.client();
		await connected(socket);
		for (const payload of [undefined, null, "doc.md", { path: 5 }, { path: "" }, {}]) {
			expect(await join(socket, payload)).toEqual({ ok: false });
		}
		// A join with no acknowledgement callback is ignored without crashing the server.
		socket.emit("join", { path: "doc.md" });
		expect(await join(socket, { path: "doc.md" })).toEqual({ ok: true });
	});
});

describe("attachRealtime signals", () => {
	it("sends doc-changed only to the room of the document that changed", async () => {
		harness = await startHarness();
		const [viewer, otherViewer, idle] = [harness.client(), harness.client(), harness.client()];
		await Promise.all([viewer, otherViewer, idle].map(connected));
		const seen = [viewer, otherViewer, idle].map((socket) =>
			record(socket, SERVER_EVENTS.docChanged),
		);
		// Joined under two spellings of the same file: the room is the resolved document.
		await join(viewer, { path: "doc.md" });
		await join(otherViewer, { path: path.join(harness.root, "other.md") });

		harness.realtime.docChanged(path.join(harness.root, "doc.md"));
		await delay(200);
		expect(seen.map((tally) => tally.count)).toEqual([1, 0, 0]);
	});

	it("stops sending doc-changed after a leave", async () => {
		harness = await startHarness();
		const socket = harness.client();
		await connected(socket);
		const seen = record(socket, SERVER_EVENTS.docChanged);
		await join(socket, { path: "doc.md" });
		expect(await socket.timeout(2000).emitWithAck("leave", { path: "doc.md" })).toEqual({
			ok: true,
		});
		harness.realtime.docChanged(path.join(harness.root, "doc.md"));
		await delay(200);
		expect(seen.count).toBe(0);
	});

	it("sends listing-changed and roots-changed to every connection", async () => {
		harness = await startHarness();
		const sockets = [harness.client(), harness.client()];
		await Promise.all(sockets.map(connected));
		await join(sockets[0], { path: "doc.md" });
		const listings = sockets.map((socket) => record(socket, SERVER_EVENTS.listingChanged));
		const roots = sockets.map((socket) => record(socket, SERVER_EVENTS.rootsChanged));

		harness.realtime.listingChanged();
		harness.realtime.rootsChanged();
		await delay(200);
		expect(listings.map((tally) => tally.count)).toEqual([1, 1]);
		expect(roots.map((tally) => tally.count)).toEqual([1, 1]);
	});

	it("closes by dropping the transport, so a client reconnects to the next server", async () => {
		harness = await startHarness();
		const socket = harness.client();
		await connected(socket);
		const reason = new Promise<string>((resolve) =>
			socket.once("disconnect", (why: string) => resolve(why)),
		);
		harness.realtime.close();
		// "io server disconnect" is the reason a socket.io client never retries after.
		expect(await reason).toBe("transport close");
	});

	it("sends no payload with a signal", async () => {
		harness = await startHarness();
		const socket = harness.client();
		await connected(socket);
		const received = new Promise<unknown[]>((resolve) =>
			socket.once(SERVER_EVENTS.listingChanged, (...args: unknown[]) => resolve(args)),
		);
		harness.realtime.listingChanged();
		expect(await received).toEqual([]);
	});

	it("delivers a write to a watched file to a joined client within one second", async () => {
		harness = await startHarness();
		const { root } = harness;
		// The watcher startServer creates, over the same root.
		const roots = [{ name: "root", dir: root }];
		const watcher = watch(root, {
			ignoreInitial: true,
			followSymlinks: false,
			ignored: (changedPath) => isWatchIgnored(roots, changedPath),
		});
		await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
		const stop = signalFileChanges(watcher, () => roots, harness.realtime);
		try {
			const socket = harness.client();
			await connected(socket);
			expect(await join(socket, { path: "doc.md" })).toEqual({ ok: true });
			const arrived = new Promise<void>((resolve) =>
				socket.once(SERVER_EVENTS.docChanged, () => resolve()),
			);
			const started = Date.now();
			await fsp.writeFile(path.join(root, "doc.md"), "# Doc\n\nEdited.\n", "utf8");
			await arrived;
			expect(Date.now() - started).toBeLessThan(1000);
		} finally {
			stop();
			await watcher.close();
		}
	});
});
