import { describe, expect, it } from "@jest/globals";
import { assert, asyncProperty, constantFrom, oneof, record, uniqueArray } from "fast-check";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import { checkCandidate, type Candidate } from "../src/servers/candidate";
import type { ProbeResult } from "../src/servers/connection";

const ID = "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e";
const OTHER = "0d6f3b1a-8c2e-4f5d-a7b9-1e3c5a7b9d0f";
const LAN = "http://192.168.1.10:4040";
const TAILNET = "https://box.tail1.ts.net:4040";

function info(id: string): ServerInfo {
	return {
		id,
		name: "box",
		version: "0.7.0",
		permissions: "full",
		mermaidVersion: "10.9.8",
		treeSchemaVersion: 1,
		tailnetUrls: [],
	};
}

function probeFrom(answers: Record<string, ProbeResult>) {
	return async (origin: string): Promise<ProbeResult> =>
		answers[origin] ?? { kind: "failed", cause: "no answer" };
}

function scanned(expectedId: string | undefined, ...urls: string[]): Candidate {
	return { origins: urls.map((url) => ({ url, source: "qr" })), expectedId };
}

describe("checkCandidate", () => {
	it("is confirmed when an origin answers with the expected id, HTTPS first", async () => {
		const check = await checkCandidate(
			scanned(ID, LAN, TAILNET),
			probeFrom({
				[LAN]: { kind: "ok", info: info(ID) },
				[TAILNET]: { kind: "ok", info: info(ID) },
			}),
		);
		expect(check).toEqual({
			kind: "confirmed",
			info: info(ID),
			answered: [
				{ url: TAILNET, source: "qr" },
				{ url: LAN, source: "qr" },
			],
		});
	});

	it("leaves out an origin that answered as another server or did not answer", async () => {
		const check = await checkCandidate(
			scanned(ID, LAN, TAILNET, "http://10.0.0.5:4040"),
			probeFrom({
				[LAN]: { kind: "ok", info: info(ID) },
				[TAILNET]: { kind: "ok", info: info(OTHER) },
			}),
		);
		expect(check).toMatchObject({ kind: "confirmed", answered: [{ url: LAN, source: "qr" }] });
	});

	it("takes any id when none is expected, the first answer in priority deciding", async () => {
		const check = await checkCandidate(
			scanned(undefined, LAN, TAILNET),
			probeFrom({
				[LAN]: { kind: "ok", info: info(ID) },
				[TAILNET]: { kind: "ok", info: info(OTHER) },
			}),
		);
		expect(check).toMatchObject({ kind: "confirmed", info: { id: OTHER } });
	});

	it("is different when origins answered and none with the expected id (I1)", async () => {
		const check = await checkCandidate(
			scanned(ID, LAN),
			probeFrom({ [LAN]: { kind: "ok", info: info(OTHER) } }),
		);
		expect(check).toEqual({ kind: "different", origins: [LAN] });
	});

	it("is unreachable with each origin's cause when nothing answers", async () => {
		const check = await checkCandidate(scanned(ID, LAN, TAILNET), probeFrom({}));
		expect(check).toEqual({
			kind: "unreachable",
			causes: [
				{ origin: TAILNET, cause: "no answer" },
				{ origin: LAN, cause: "no answer" },
			],
		});
	});
});

describe("checkCandidate (property)", () => {
	const URLS = [LAN, TAILNET, "https://box.tail1.ts.net", "http://10.0.0.5:4040"];

	it("confirms only an answer with the expected id, and only origins that gave it", async () => {
		await assert(
			asyncProperty(
				uniqueArray(
					record({
						url: constantFrom(...URLS),
						answer: oneof(constantFrom(ID, OTHER), constantFrom(undefined)),
					}),
					{ maxLength: 4, selector: (entry) => entry.url },
				),
				constantFrom(ID, OTHER, undefined),
				async (entries, expectedId) => {
					const answers = Object.fromEntries(
						entries.flatMap((entry) =>
							entry.answer === undefined
								? []
								: [[entry.url, { kind: "ok", info: info(entry.answer) } satisfies ProbeResult]],
						),
					);
					const check = await checkCandidate(
						scanned(expectedId, ...entries.map((entry) => entry.url)),
						probeFrom(answers),
					);
					if (check.kind === "confirmed") {
						if (expectedId !== undefined) expect(check.info.id).toBe(expectedId);
						for (const origin of check.answered) {
							expect(answers[origin.url]?.info.id).toBe(check.info.id);
						}
					} else if (check.kind === "different") {
						expect(expectedId).toBeDefined();
						expect(entries.some((entry) => entry.answer === expectedId)).toBe(false);
					} else {
						expect(entries.every((entry) => entry.answer === undefined)).toBe(true);
					}
				},
			),
			{ numRuns: 200 },
		);
	});
});
