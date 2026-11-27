import { describe, expect, it } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";
import { realtimeFor } from "../src/servers/realtime";

// createRealtime is the never-connecting stand-in from tests/setup/realtime.js.

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
});
