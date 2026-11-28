import { describe, expect, it } from "vitest";
import { buildQrPayload } from "../discovery.js";

const SERVER_ID = "7f0c2c1e-9d3b-4c1a-8e52-0b6f6f1d2a90";

describe("buildQrPayload", () => {
	it("puts the server id in the fragment of the origin", () => {
		expect(
			buildQrPayload({ origin: "https://box.tail1234.ts.net:4040", serverId: SERVER_ID }),
		).toBe(`https://box.tail1234.ts.net:4040/#mdxserve=${SERVER_ID}`);
	});

	it("keeps only the origin of what it is given", () => {
		expect(
			buildQrPayload({
				origin: "http://192.168.1.10:4040/notes/a.md?x=1#top",
				serverId: SERVER_ID,
			}),
		).toBe(`http://192.168.1.10:4040/#mdxserve=${SERVER_ID}`);
	});

	it("drops a default port and a user name", () => {
		expect(
			buildQrPayload({ origin: "https://me:secret@box.ts.net:443", serverId: SERVER_ID }),
		).toBe(`https://box.ts.net/#mdxserve=${SERVER_ID}`);
	});

	it("is a URL whose origin and fragment give the two values back", () => {
		const url = new URL(buildQrPayload({ origin: "http://[::1]:4040", serverId: SERVER_ID }));
		expect(url.origin).toBe("http://[::1]:4040");
		expect(url.pathname).toBe("/");
		expect(url.search).toBe("");
		expect(new URLSearchParams(url.hash.slice(1)).get("mdxserve")).toBe(SERVER_ID);
	});
});
