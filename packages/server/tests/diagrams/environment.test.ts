import { afterEach, expect, it, vi } from "vitest";
import { environment } from "../../src/diagrams/adapters/environment";
afterEach(() => vi.unstubAllEnvs());
it("preserves gateway auth and Windows resolution without forwarding unrelated secrets", () => {
	vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "test-token");
	vi.stubEnv("ANTHROPIC_BASE_URL", "https://gateway.example");
	vi.stubEnv("PATHEXT", ".EXE;.CMD");
	vi.stubEnv("UNRELATED_SECRET", "private");
	expect(environment()).toMatchObject({
		ANTHROPIC_AUTH_TOKEN: "test-token",
		ANTHROPIC_BASE_URL: "https://gateway.example",
		PATHEXT: ".EXE;.CMD",
	});
	expect(environment()).not.toHaveProperty("UNRELATED_SECRET");
});
