import { describe, expect, it } from "vitest";
import { staleBuildAction } from "../../client/stale-build";

describe("staleBuildAction", () => {
	it("reloads when a chunk fails to load and nothing is being edited", () => {
		expect(staleBuildAction(false, null, 1_000_000)).toBe("reload");
	});

	it("asks instead of reloading while an editor is open, so unsaved text is kept", () => {
		expect(staleBuildAction(true, null, 1_000_000)).toBe("ask");
	});

	it("asks instead of reloading twice within 30 seconds, so a broken build cannot loop", () => {
		expect(staleBuildAction(false, 1_000_000, 1_029_999)).toBe("ask");
		expect(staleBuildAction(false, 1_000_000, 1_030_000)).toBe("reload");
	});
});
