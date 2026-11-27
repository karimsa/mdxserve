import { describe, expect, it, vi } from "vitest";
import {
	createRealtimeClient,
	REFUSED_RETRY_DELAY_MS,
	RETRY_DELAY_MAX_MS,
	RETRY_DELAY_MS,
	type DocChangeCause,
	type RealtimeSocket,
} from "../../client/realtime.js";

/** A socket.io client socket stand-in: records emits and lets a test fire events. */
class FakeSocket implements RealtimeSocket {
	connected = false;
	readonly emitted: Array<{ event: string; payload: unknown }> = [];
	ackWith: unknown = { ok: true };
	readonly delays = { min: 1000, max: 5000 };
	readonly io = {
		reconnectionDelay: (ms: number) => {
			this.delays.min = ms;
		},
		reconnectionDelayMax: (ms: number) => {
			this.delays.max = ms;
		},
	};
	private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

	on(event: string, listener: (...args: unknown[]) => void): void {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
	}

	emit(event: string, payload: unknown, ack: (result: unknown) => void): void {
		this.emitted.push({ event, payload });
		ack(this.ackWith);
	}

	fire(event: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(event) ?? []) listener(...args);
	}

	connect(): void {
		this.connected = true;
		this.fire("connect");
	}

	drop(): void {
		this.connected = false;
		this.fire("disconnect");
	}

	/** Emits since the last call, as `event path` strings. */
	takeEmitted(): string[] {
		const taken = this.emitted.map(
			({ event, payload }) => `${event} ${(payload as { path: string }).path}`,
		);
		this.emitted.length = 0;
		return taken;
	}
}

function setup() {
	const socket = new FakeSocket();
	const client = createRealtimeClient(socket);
	const docs: Array<[string, DocChangeCause]> = [];
	let listings = 0;
	let roots = 0;
	client.onDocChanged((path, cause) => docs.push([path, cause]));
	client.onListingChanged(() => {
		listings += 1;
	});
	client.onRootsChanged(() => {
		roots += 1;
	});
	return {
		socket,
		client,
		docs,
		counts: () => ({ listings, roots }),
	};
}

describe("createRealtimeClient", () => {
	it("joins the open document once the socket connects, without a stale signal", () => {
		const { socket, client, docs, counts } = setup();
		client.joinDocument("/r/a.md");
		expect(socket.takeEmitted()).toEqual([]);
		socket.connect();
		expect(socket.takeEmitted()).toEqual(["join /r/a.md"]);
		expect(docs).toEqual([]);
		expect(counts()).toEqual({ listings: 0, roots: 0 });
	});

	it("rejoins and signals everything stale on every reconnect", () => {
		const { socket, client, docs, counts } = setup();
		socket.connect();
		client.joinDocument("/r/a.md");
		socket.takeEmitted();

		for (const round of [1, 2]) {
			socket.drop();
			socket.connect();
			expect(socket.takeEmitted()).toEqual(["join /r/a.md"]);
			expect(docs).toHaveLength(round);
			expect(docs[round - 1]).toEqual(["/r/a.md", "stale"]);
			expect(counts()).toEqual({ listings: round, roots: round });
		}
	});

	it("signals everything stale when the first connection only succeeds after failing", () => {
		const { socket, client, docs, counts } = setup();
		client.joinDocument("/r/a.md");
		socket.fire("connect_error", new Error("xhr poll error"));
		socket.connect();
		expect(socket.takeEmitted()).toEqual(["join /r/a.md"]);
		expect(docs).toEqual([["/r/a.md", "stale"]]);
		expect(counts()).toEqual({ listings: 1, roots: 1 });
	});

	it("signals only the listing and roots on a reconnect with no document open", () => {
		const { socket, docs, counts } = setup();
		socket.connect();
		socket.drop();
		socket.connect();
		expect(socket.takeEmitted()).toEqual([]);
		expect(docs).toEqual([]);
		expect(counts()).toEqual({ listings: 1, roots: 1 });
	});

	it("attributes doc-changed to the open document", () => {
		const { socket, client, docs } = setup();
		socket.connect();
		socket.fire("doc-changed");
		expect(docs).toEqual([]);
		client.joinDocument("/r/a.md");
		socket.fire("doc-changed");
		expect(docs).toEqual([["/r/a.md", "changed"]]);
	});

	it("leaves the previous document when another opens, and rejoining one marks it stale", () => {
		const { socket, client, docs } = setup();
		socket.connect();
		client.joinDocument("/r/a.md");
		client.leaveDocument("/r/a.md");
		client.joinDocument("/r/b.md");
		client.joinDocument("/r/a.md");
		expect(socket.takeEmitted()).toEqual([
			"join /r/a.md",
			"leave /r/a.md",
			"join /r/b.md",
			"leave /r/b.md",
			"join /r/a.md",
		]);
		expect(docs).toEqual([["/r/a.md", "stale"]]);
	});

	it("ignores a leave for a document that is not open", () => {
		const { socket, client } = setup();
		socket.connect();
		client.joinDocument("/r/a.md");
		client.leaveDocument("/r/b.md");
		expect(socket.takeEmitted()).toEqual(["join /r/a.md"]);
		socket.fire("doc-changed");
	});

	it("drops a signal that arrives with a payload", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { socket, client, docs, counts } = setup();
		socket.connect();
		client.joinDocument("/r/a.md");
		socket.fire("doc-changed", { path: "/r/other.md" });
		socket.fire("listing-changed", "x");
		expect(docs).toEqual([]);
		expect(counts()).toEqual({ listings: 0, roots: 0 });
		expect(warn).toHaveBeenCalledTimes(2);
		warn.mockRestore();
	});

	it("warns when the server refuses a join or sends a malformed ack", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { socket, client } = setup();
		socket.connect();
		socket.ackWith = { ok: false };
		client.joinDocument("/r/a.md");
		expect(warn).toHaveBeenCalledTimes(1);
		// Opening b leaves a, so both acks are malformed.
		socket.ackWith = "nonsense";
		client.joinDocument("/r/b.md");
		expect(warn).toHaveBeenCalledTimes(3);
		warn.mockRestore();
	});

	it("backs off to a slow retry when the server refuses the handshake, and recovers on connect", () => {
		const { socket } = setup();
		// A server that is down: socket.io's usual pace.
		socket.fire("connect_error", Object.assign(new Error("xhr poll error"), { description: 0 }));
		socket.fire("connect_error", new Error("timeout"));
		expect(socket.delays).toEqual({ min: RETRY_DELAY_MS, max: RETRY_DELAY_MAX_MS });
		// A refused handshake: once a minute.
		socket.fire("connect_error", Object.assign(new Error("xhr poll error"), { description: 403 }));
		expect(socket.delays).toEqual({ min: REFUSED_RETRY_DELAY_MS, max: REFUSED_RETRY_DELAY_MS });
		socket.connect();
		expect(socket.delays).toEqual({ min: RETRY_DELAY_MS, max: RETRY_DELAY_MAX_MS });
	});

	it("stops calling a listener after it unsubscribes", () => {
		const socket = new FakeSocket();
		const client = createRealtimeClient(socket);
		const listener = vi.fn();
		const unsubscribe = client.onListingChanged(listener);
		socket.connect();
		socket.fire("listing-changed");
		unsubscribe();
		socket.fire("listing-changed");
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
