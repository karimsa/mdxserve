import { it, expect } from "vitest";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { makeContext } from "../helpers/context.js";
import { fixtureRegistry } from "../fixtures/registry.js";
import { fixture, input, draft } from "./fixture.js";
const caller = createCallerFactory(appRouter);
it("requires loopback even for preference reads", async () => {
	const test = fixture();
	try {
		const api = caller(
			makeContext("/tmp", fixtureRegistry, { diagrams: test.service, isLoopback: false }),
		);
		await expect(api.getDiagramPreferences({})).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(api.convertDiagram(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(test.port.convert).not.toHaveBeenCalled();
	} finally {
		test.cleanup();
	}
});
it("rejects cross-origin conversion and invalid input", async () => {
	const test = fixture();
	try {
		const api = caller(
			makeContext("/tmp", fixtureRegistry, {
				diagrams: test.service,
				isLoopback: true,
				host: "localhost:3000",
				origin: "https://foreign.example",
			}),
		);
		await expect(api.convertDiagram(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
		const local = caller(
			makeContext("/tmp", fixtureRegistry, { diagrams: test.service, isLoopback: true }),
		);
		await expect(local.convertDiagram({ ...input, text: "a".repeat(16001) })).rejects.toMatchObject(
			{ code: "BAD_REQUEST" },
		);
	} finally {
		test.cleanup();
	}
});
it("returns typed drafts and persists disabled preference", async () => {
	const test = fixture();
	try {
		const api = caller(
			makeContext("/tmp", fixtureRegistry, { diagrams: test.service, isLoopback: true }),
		);
		expect(await api.convertDiagram(input)).toEqual({ ...draft, provider: "codex" });
		expect(await api.setDiagramPreferences({ agent: "disabled" })).toEqual({
			agent: "disabled",
			configured: true,
			models: { codex: "gpt-6-luna", claude: "haiku" },
		});
		await expect(api.convertDiagram({ ...input, revision: 2 })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	} finally {
		test.cleanup();
	}
});
