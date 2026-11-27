import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { attachRealtime, type Realtime } from "../../src/realtime/server.js";
import { realtimePeerCheck } from "../../src/http/host.js";
import { DocsService } from "../../src/docs/service.js";
import { RootsService } from "../../src/roots/service.js";
import type { PermissionMode } from "../../src/servers/bind-host.js";
import { REALTIME_PATH } from "@mdxserve/shared/realtime";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

/** A real http server on an ephemeral loopback port with the realtime adapter attached. */
export interface Harness {
	root: string;
	outside: string;
	docs: DocsService;
	realtime: Realtime;
	port: number;
	/** Opens a websocket client; `headers` are sent with the handshake. */
	client(headers?: Record<string, string>): Socket;
	close(): Promise<void>;
}

/** A root with two docs, a hidden doc, a public alias of the hidden doc, and a doc outside it. */
export async function startHarness(
	permissions: PermissionMode = "full",
	tailnet?: Parameters<typeof realtimePeerCheck>[1],
): Promise<Harness> {
	const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-realtime-")));
	const outside = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-realtime-outside-")),
	);
	await fs.writeFile(path.join(root, "doc.md"), "# Doc\n", "utf8");
	await fs.writeFile(path.join(root, "other.md"), "# Other\n", "utf8");
	await fs.mkdir(path.join(root, ".hidden"));
	await fs.writeFile(path.join(root, ".hidden", "secret.md"), "# Secret\n", "utf8");
	await fs.symlink(path.join(root, ".hidden", "secret.md"), path.join(root, "alias.md"));
	await fs.writeFile(path.join(outside, "out.md"), "# Out\n", "utf8");

	const docs = new DocsService(new RootsService(root, os.homedir(), [root]), registry);
	const server = http.createServer((_, res) => {
		res.statusCode = 404;
		res.end();
	});
	const realtime = attachRealtime(server, {
		docs,
		permissions,
		acceptsPeer: realtimePeerCheck(permissions, tailnet),
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	const clients: Socket[] = [];

	return {
		root,
		outside,
		docs,
		realtime,
		port,
		client(headers = {}) {
			const socket = connect(`http://127.0.0.1:${port}`, {
				path: REALTIME_PATH,
				transports: ["websocket"],
				reconnection: false,
				forceNew: true,
				extraHeaders: headers,
			});
			clients.push(socket);
			return socket;
		},
		async close() {
			for (const socket of clients) socket.disconnect();
			realtime.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await fs.rm(root, { recursive: true, force: true });
			await fs.rm(outside, { recursive: true, force: true });
		},
	};
}

/** Resolves once the socket connects, rejects with the handshake error. */
export function connected(socket: Socket): Promise<void> {
	return new Promise((resolve, reject) => {
		if (socket.connected) return resolve();
		socket.once("connect", () => resolve());
		socket.once("connect_error", reject);
	});
}

/** Join and return the server's acknowledgement. */
export async function join(socket: Socket, payload: unknown): Promise<unknown> {
	return socket.timeout(2000).emitWithAck("join", payload);
}

/** Counts each server event a socket receives. */
export function record(socket: Socket, event: string): { count: number } {
	const tally = { count: 0 };
	socket.on(event, () => {
		tally.count += 1;
	});
	return tally;
}

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
