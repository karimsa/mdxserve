import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { TailscaleService, type TailscaleRunner } from "../../src/tailscale/service.js";

/** What one generated CLI call does. */
const behaviour = fc.oneof(
	fc.record({
		kind: fc.constant("throw" as const),
		code: fc.constantFrom("ENOENT", "EACCES", undefined),
	}),
	fc.record({ kind: fc.constant("throw-value" as const), value: fc.anything() }),
	fc.record({
		kind: fc.constant("print" as const),
		code: fc.integer({ min: -1, max: 3 }),
		stdout: fc.oneof(
			fc.string(),
			fc.jsonValue().map((value) => JSON.stringify(value)),
			fc.constant(JSON.stringify({ BackendState: "Running", Self: { DNSName: "a.b.ts.net." } })),
			fc.constant("{}"),
		),
	}),
);

describe("TailscaleService properties", () => {
	it("detect never throws and always returns a known kind, whatever the runner does", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(behaviour, { minLength: 1, maxLength: 6 }),
				fc.constantFrom("darwin", "win32", "linux") as fc.Arbitrary<NodeJS.Platform>,
				async (behaviours, platform) => {
					let index = 0;
					const run: TailscaleRunner = async () => {
						const next = behaviours[Math.min(index, behaviours.length - 1)];
						index += 1;
						if (next.kind === "throw") throw Object.assign(new Error("boom"), { code: next.code });
						if (next.kind === "throw-value") throw next.value;
						return { code: next.code, stdout: next.stdout };
					};
					const detection = await new TailscaleService(run, platform, {}).detect({
						port: 4040,
						boundHost: "127.0.0.1",
					});
					expect(["not-found", "not-running", "failed", "running"]).toContain(detection.kind);
				},
			),
			{ numRuns: 300 },
		);
	});
});
