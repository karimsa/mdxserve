import { buildQrPayload } from "@mdxserve/shared/discovery";
import { renderUnicodeCompact } from "uqr";
import {
	reachableOrigins,
	shareOrigin,
	type NetworkInterfaces,
	type ReachableOrigin,
} from "../discovery/addresses.js";
import type { LiveServer } from "../servers/mounted-roots.js";
import { serverBaseUrl } from "../servers/remote.js";
import { NO_SERVER_MESSAGE } from "./format.js";
import { fail, ok, type CommandOutcome } from "./outcome.js";

/** @internal Exported for its tests. */
export const UNREACHABLE_MESSAGE =
	'this server listens only on this computer and no tailscale serve address reaches it, so no other device can open it. Run the tailscale serve command that startup printed, or see "Exposing it on a network" in docs/advanced.md.';

/** @internal Exported for its tests. */
export const NO_LAN_MESSAGE =
	"this server listens only on this computer, so it has no LAN address. Start it with --host to listen on the network, or leave out --lan.";

/**
 * The largest QR version printed. Version 13 is 69 modules a side; with the 2-module border
 * and two rows to a line, the code is 73 columns by 37 lines, so it and the three lines under
 * it fit an 80-column, 40-row terminal.
 */
const MAX_QR_VERSION = 13;

const HINTS: Record<ReachableOrigin["via"], string> = {
	tailnet:
		"Scan it in the mdxserve app: Servers, Add server, Scan a QR code. The phone must be on your tailnet.",
	lan: "Scan it in the mdxserve app: Servers, Add server, Scan a QR code. The phone must be on the same network as this computer.",
};

/**
 * The code draws light modules as blocks and dark ones as blanks, which reads right on a dark
 * terminal. In a colour terminal, white blocks on black make it read right on a light one too:
 * inverted, some scanners do not see it.
 */
function onBlack(line: string): string {
	return `\u001B[97;40m${line}\u001B[0m`;
}

/**
 * `mdxserve qr`: a QR code of the running server's address, for the app to scan. It holds the
 * origin another device can open (the tailnet address, or the LAN one with `--lan` or when
 * there is no tailnet address) and the server's id, and nothing secret.
 */
export async function runQr(
	options: { lan?: boolean; json?: boolean },
	deps: { server: LiveServer; interfaces: NetworkInterfaces; color: boolean },
): Promise<CommandOutcome> {
	const record = deps.server.record();
	if (record === undefined) return fail(NO_SERVER_MESSAGE);
	const answer = await deps.server.remote.getServerInfo();
	if (answer.kind === "unavailable") {
		return fail(`the server at ${serverBaseUrl(record)} did not answer`);
	}
	if (answer.kind === "error") return fail(answer.message);

	const origins = reachableOrigins({
		boundHost: record.host,
		port: record.port,
		tailnetUrls: answer.value.tailnetUrls,
		interfaces: deps.interfaces,
	});
	const chosen = shareOrigin(origins, { preferLan: options.lan === true });
	if (chosen.kind === "unreachable") return fail(UNREACHABLE_MESSAGE);
	if (chosen.kind === "no-lan") return fail(NO_LAN_MESSAGE);

	const { url, via } = chosen.origin;
	const payload = buildQrPayload({ origin: url, serverId: answer.value.id });
	if (options.json) return ok([JSON.stringify({ url, payload, via }, null, 2)]);

	let code: string;
	try {
		code = renderUnicodeCompact(payload, { ecc: "M", border: 2, maxVersion: MAX_QR_VERSION });
	} catch {
		return fail(`${url} is too long for a QR code that fits the terminal`);
	}
	const lines = code.split("\n").filter((line) => line.length > 0);
	return ok([...(deps.color ? lines.map(onBlack) : lines), url, HINTS[via]]);
}
