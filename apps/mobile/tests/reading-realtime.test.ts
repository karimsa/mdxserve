import { describe, expect, it, jest } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";
import { realtimeFor } from "../src/servers/realtime";

/** The roots signal of every socket opened, so a test can send it. */
const mockRootsListeners: Array<() => void> = [];

jest.mock("@mdxserve/client/realtime", () => ({
	createRealtime: () => ({
		joinDocument() {},
		leaveDocument() {},
		onDocChanged: () => () => {},
		onListingChanged: () => () => {},
		onRootsChanged: (listener: () => void) => {
			mockRootsListeners.push(listener);
			return () => {};
		},
		close() {},
	}),
}));

describe("realtimeFor", () => {
	it("keeps one socket per server while its address stays the same", () => {
		const queryClient = new QueryClient();
		const first = realtimeFor("same-address", "https://a.example", queryClient);
		expect(realtimeFor("same-address", "https://a.example", queryClient)).toBe(first);
	});

	it("refetches the server's documents and listings when it is reached at another address", () => {
		const queryClient = new QueryClient();
		const documentKey = ["moved", "getDocument", { path: "/srv/a.md" }];
		const listingKey = ["moved", "getFolderListing", { path: "/srv" }];
		const otherKey = ["elsewhere", "getDocument", { path: "/srv/a.md" }];
		const original = realtimeFor("moved", "https://lan.example", queryClient);
		for (const key of [documentKey, listingKey, otherKey])
			queryClient.setQueryData(key, { ok: true });
		const replaced = realtimeFor("moved", "https://tailnet.example", queryClient);
		expect(replaced).not.toBe(original);
		expect(queryClient.getQueryState(documentKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(listingKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
	});

	it("reads the server's roots and documents again when its folders change", () => {
		const queryClient = new QueryClient();
		realtimeFor("roots-moved", "https://a.example", queryClient);
		const rootsChanged = mockRootsListeners.at(-1);
		const documentKey = ["roots-moved", "getDocument", { path: "/srv/a.md" }];
		const rootsKey = ["roots-moved", "listRoots", {}];
		for (const key of [documentKey, rootsKey]) queryClient.setQueryData(key, { ok: true });
		rootsChanged?.();
		expect(queryClient.getQueryState(documentKey)?.isInvalidated).toBe(true);
		expect(queryClient.getQueryState(rootsKey)?.isInvalidated).toBe(true);
	});
});
