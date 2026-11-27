import { describe, expect, it } from "vitest";
import { defaultServerName, parseServerName } from "../../src/server-info/name.js";

describe("defaultServerName", () => {
	it("drops a trailing .local", () => {
		expect(defaultServerName("Karims-MacBook-Air.local")).toBe("Karims-MacBook-Air");
		expect(defaultServerName("box.LOCAL")).toBe("box");
	});

	it("keeps any other domain", () => {
		expect(defaultServerName("box.example.com")).toBe("box.example.com");
	});

	it("cuts to 63 bytes without splitting a character", () => {
		const name = defaultServerName("é".repeat(40));
		expect(Buffer.byteLength(name)).toBe(62);
		expect(name).toBe("é".repeat(31));
	});

	it("falls back to mdxserve for an empty hostname", () => {
		expect(defaultServerName("")).toBe("mdxserve");
		expect(defaultServerName(".local")).toBe("mdxserve");
	});
});

describe("parseServerName", () => {
	it("accepts and trims a name", () => {
		expect(parseServerName("  Studio Mac ")).toEqual({ kind: "ok", name: "Studio Mac" });
	});

	it("refuses an empty name, a control character and more than 63 bytes", () => {
		expect(parseServerName("   ").kind).toBe("error");
		expect(parseServerName("a\nb").kind).toBe("error");
		expect(parseServerName("x".repeat(64)).kind).toBe("error");
		expect(parseServerName("x".repeat(63)).kind).toBe("ok");
	});
});
