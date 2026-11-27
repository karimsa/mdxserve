import path from "node:path";
import * as fc from "fast-check";
import { afterAll, beforeAll, describe, it } from "vitest";
import type { Socket } from "socket.io-client";
import type { PermissionMode } from "../../src/servers/bind-host.js";
import { connected, join, startHarness, type Harness } from "../helpers/realtime.js";

const MODES: PermissionMode[] = ["full", "restricted"];

describe.each(MODES)("attachRealtime join in %s mode", (mode) => {
	let harness: Harness;
	let socket: Socket;

	beforeAll(async () => {
		harness = await startHarness(mode);
		socket = harness.client();
		await connected(socket);
	});

	afterAll(async () => {
		await harness.close();
	});

	it("acknowledges ok exactly when getDocument would serve the same path", async () => {
		const names = ["doc.md", "other.md", "alias.md", ".hidden/secret.md", "missing.md", "..", ""];
		const pathArbitrary = fc.oneof(
			fc.string({ maxLength: 40 }),
			fc.constantFrom(...names),
			fc.constantFrom(...names).map((name) => path.join(harness.root, name)),
			fc.constantFrom(...names).map((name) => path.join(harness.outside, name)),
			fc
				.array(fc.constantFrom("..", ".", ".hidden", "doc.md", "out.md", "x"), { maxLength: 5 })
				.map((segments) => path.join(harness.root, ...segments)),
		);
		await fc.assert(
			fc.asyncProperty(pathArbitrary, async (requested) => {
				const ack = await join(socket, { path: requested });
				// A path the schema refuses (empty) is a malformed join, and
				// getDocument's input schema refuses it too.
				const served =
					requested.length > 0 &&
					(await harness.docs.readDocument(requested, mode === "restricted")).kind === "ok";
				return JSON.stringify(ack) === JSON.stringify({ ok: served });
			}),
			{ numRuns: 150 },
		);
	});
});
