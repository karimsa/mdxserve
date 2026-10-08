import { afterEach, expect, it, vi } from "vitest";
import { printBanner } from "../../src/http/start.js";

afterEach(() => vi.restoreAllMocks());

it.each([
	["127.0.0.1", "http://127.0.0.1:4040"],
	["127.0.0.2", "http://127.0.0.2:4040"],
	["::1", "http://[::1]:4040"],
	["192.168.1.10", "http://192.168.1.10:4040"],
	["2001:db8::1", "http://[2001:db8::1]:4040"],
	["0.0.0.0", "http://127.0.0.1:4040"],
	["::", "http://127.0.0.1:4040"],
])("advertises reachable local, API and document URLs for %s", (host, baseUrl) => {
	const output: string[] = [];
	vi.spyOn(console, "log").mockImplementation((line: string) => {
		output.push(line);
	});
	printBanner(4040, host, false, [{ name: "docs", dir: "/notes" }]);
	const banner = output.join("\n");
	expect(banner).toContain(`- Local:    ${baseUrl}`);
	expect(banner).toContain(`- API:      ${baseUrl}/__mdxserve/trpc`);
	expect(banner).toContain(`- docs: ${baseUrl}/notes/`);
	if (host === "127.0.0.2" || host === "::1") expect(banner).not.toContain("- Network:");
	if (host === "2001:db8::1") expect(banner).toContain(`- Network:  ${baseUrl}`);
});
