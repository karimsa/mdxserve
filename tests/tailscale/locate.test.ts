import { describe, expect, it } from "vitest";
import { tailscaleCandidates } from "../../src/tailscale/locate.js";

describe("tailscaleCandidates", () => {
	it("tries PATH, then the app bundle, on macOS", () => {
		expect(tailscaleCandidates("darwin", {})).toEqual([
			"tailscale",
			"/Applications/Tailscale.app/Contents/MacOS/Tailscale",
		]);
	});

	it("tries PATH, then the default install folder, on Windows", () => {
		expect(tailscaleCandidates("win32", {})).toEqual([
			"tailscale",
			"C:\\Program Files\\Tailscale\\tailscale.exe",
		]);
		expect(tailscaleCandidates("win32", { ProgramFiles: "D:\\Apps" })).toEqual([
			"tailscale",
			"D:\\Apps\\Tailscale\\tailscale.exe",
		]);
	});

	it("tries only PATH on Linux", () => {
		expect(tailscaleCandidates("linux", {})).toEqual(["tailscale"]);
	});

	it("uses MDXSERVE_TAILSCALE_CLI alone when it is set", () => {
		for (const platform of ["darwin", "win32", "linux"] as const) {
			expect(tailscaleCandidates(platform, { MDXSERVE_TAILSCALE_CLI: "/opt/ts" })).toEqual([
				"/opt/ts",
			]);
		}
		expect(tailscaleCandidates("linux", { MDXSERVE_TAILSCALE_CLI: "  " })).toEqual(["tailscale"]);
	});
});
