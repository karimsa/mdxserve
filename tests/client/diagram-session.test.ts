// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { sessionId } from "../../client/diagrams/session-id";
it("makes unique UUID sessions without secure-context randomUUID", () => {
	vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
	try {
		const values = Array.from({ length: 50 }, sessionId);
		expect(new Set(values).size).toBe(50);
		for (const value of values)
			expect(value).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
	} finally {
		vi.unstubAllGlobals();
	}
});
