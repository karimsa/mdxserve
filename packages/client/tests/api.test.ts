import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api";

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubFetch() {
	const fetchMock = vi.fn(
		async () =>
			new Response(JSON.stringify({ result: { data: { json: { ok: true } } } }), {
				headers: { "content-type": "application/json" },
			}),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function requestedUrl(fetchMock: ReturnType<typeof stubFetch>): URL {
	const [input] = fetchMock.mock.calls[0] as unknown as [string | URL | Request];
	return new URL(typeof input === "string" || input instanceof URL ? input : input.url);
}

describe("createApiClient", () => {
	it("sends a query to the procedure under the given server's origin", async () => {
		const fetchMock = stubFetch();
		const client = createApiClient("https://box.example:4040");
		await client.getDocTree.query({}).catch(() => {});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const url = requestedUrl(fetchMock);
		expect(url.origin).toBe("https://box.example:4040");
		expect(url.pathname).toBe("/__mdxserve/trpc/getDocTree");
	});

	it("keeps one request per call instead of batching", async () => {
		const fetchMock = stubFetch();
		const client = createApiClient("https://box.example:4040");
		await Promise.all([client.getDocTree.query({}), client.getDocTree.query({})]).catch(() => {});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
