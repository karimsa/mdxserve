import type { ServerInfo } from "@mdxserve/shared/server-info";
import type { Probe } from "./connection";
import { byPriority, type SourcedOrigin } from "./store";

/**
 * A server the reader may add, before it is confirmed: the origins it may be reached at, with
 * where each came from, and the id the source named (a QR code does), if any. Every way of adding
 * a server makes one and checks it with `checkCandidate`; only a confirmed one is added.
 */
export interface Candidate {
	origins: SourcedOrigin[];
	expectedId: string | undefined;
}

export type CandidateCheck =
	/**
	 * An origin answered with the expected id (with any id when none was expected). `answered`
	 * holds every origin that answered with that id, the first in address priority first.
	 */
	| { kind: "confirmed"; info: ServerInfo; answered: SourcedOrigin[] }
	/** Origins answered, and none with the expected id. */
	| { kind: "different"; origins: string[] }
	/** No origin answered as an mdxserve server. */
	| { kind: "unreachable"; causes: Array<{ origin: string; cause: string }> };

export type ConfirmedCandidate = Extract<CandidateCheck, { kind: "confirmed" }>;

/**
 * Ask every origin of the candidate for `getServerInfo` at once, and say whether it is the
 * server it claims to be (I1). The id is not a credential: it catches an address that reaches
 * another server than the one the code or advert named, not a server that copied the id.
 */
export async function checkCandidate(candidate: Candidate, probe: Probe): Promise<CandidateCheck> {
	const ordered = byPriority(candidate.origins);
	const results = await Promise.all(ordered.map((origin) => probe(origin.url)));
	const answers = ordered.flatMap((origin, index) => {
		const result = results[index];
		return result?.kind === "ok" ? [{ origin, info: result.info }] : [];
	});
	const wantedId = candidate.expectedId ?? answers[0]?.info.id;
	const matching = answers.filter((answer) => answer.info.id === wantedId);
	const [first] = matching;
	if (first !== undefined) {
		return {
			kind: "confirmed",
			info: first.info,
			answered: matching.map((answer) => answer.origin),
		};
	}
	if (answers.length > 0) {
		return { kind: "different", origins: answers.map((answer) => answer.origin.url) };
	}
	return {
		kind: "unreachable",
		causes: ordered.flatMap((origin, index) => {
			const result = results[index];
			return result?.kind === "failed" ? [{ origin: origin.url, cause: result.cause }] : [];
		}),
	};
}
