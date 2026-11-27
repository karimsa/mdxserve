import { createApiClient } from "@mdxserve/client/api";
import { serverInfoSchema } from "@mdxserve/shared/server-info";
import type { Probe } from "./connection";

/** How long an address has to answer `getServerInfo` (C2). */
const PROBE_TIMEOUT_MS = 5000;

export type ServerInfoClient = Pick<ReturnType<typeof createApiClient>, "getServerInfo">;

/** The HTTP status in a tRPC error's data, when the server answered at all. */
function httpStatusOf(error: unknown): number | undefined {
	const data = (error as { data?: { httpStatus?: unknown } } | null)?.data;
	return typeof data?.httpStatus === "number" ? data.httpStatus : undefined;
}

/** Why an address did not answer as an mdxserve server, in words for the reader. */
function causeOf(error: unknown, timedOut: boolean): string {
	if (timedOut) return `no answer within ${PROBE_TIMEOUT_MS / 1000} seconds`;
	const status = httpStatusOf(error);
	if (status === 404) {
		return "it has no getServerInfo; update mdxserve on that computer, or check the address";
	}
	if (status !== undefined) return `it answered with HTTP ${status}`;
	const cause = (error as { cause?: unknown } | null)?.cause;
	if (cause instanceof SyntaxError) return "it answered, but not as an mdxserve server";
	return `could not connect (${error instanceof Error ? error.message : String(error)})`;
}

/**
 * Ask an origin for `getServerInfo`, giving up after five seconds, and check the answer
 * against the shared schema. Never rejects.
 */
export function createProbe(
	clientFor: (origin: string) => ServerInfoClient = createApiClient,
	timeoutMs = PROBE_TIMEOUT_MS,
): Probe {
	return async (origin) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const answer = await clientFor(origin).getServerInfo.query(undefined, {
				signal: controller.signal,
			});
			const parsed = serverInfoSchema.safeParse(answer);
			return parsed.success
				? { kind: "ok", info: parsed.data }
				: { kind: "failed", cause: "it answered, but not as an mdxserve server" };
		} catch (error) {
			return { kind: "failed", cause: causeOf(error, controller.signal.aborted) };
		} finally {
			clearTimeout(timer);
		}
	};
}
