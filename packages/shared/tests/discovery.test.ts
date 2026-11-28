import { describe, expect, it } from "vitest";
import { buildQrPayload, parseQrPayload } from "../discovery.js";

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

describe("parseQrPayload", () => {
	it("reads back what buildQrPayload made", () => {
		for (const origin of [
			"https://box.tail1234.ts.net:4040",
			"https://box.ts.net",
			"http://192.168.1.10:4040",
			"http://[fd00::1]:4040",
		]) {
			expect(parseQrPayload(buildQrPayload({ origin, serverId: SERVER_ID }))).toEqual({
				kind: "ok",
				origin,
				serverId: SERVER_ID,
			});
		}
	});

	it("reads a plain address with no id, keeping only its origin", () => {
		expect(parseQrPayload("https://box.ts.net:4040/notes/a.md?x=1#top")).toEqual({
			kind: "ok",
			origin: "https://box.ts.net:4040",
			serverId: undefined,
		});
	});

	it.each([
		["a Wi-Fi code", "WIFI:S:home;T:WPA;P:secret;;"],
		["plain text", "hello"],
		["another scheme", "ftp://box.ts.net/"],
		["javascript", "javascript:alert(1)"],
		["a user name and password", "https://me:secret@box.ts.net/#mdxserve=" + SERVER_ID],
		["a user name", "https://me@box.ts.net/"],
		["an id that is not one", "https://box.ts.net/#mdxserve=not-an-id"],
		["600 characters", `https://box.ts.net/${"a".repeat(580)}`],
		["an empty code", ""],
	])("refuses %s", (_, text) => {
		expect(parseQrPayload(text)).toEqual({
			kind: "error",
			message: "That code is not an mdxserve address.",
		});
	});
});
