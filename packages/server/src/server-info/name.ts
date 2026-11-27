import { SERVER_NAME_MAX_BYTES } from "@mdxserve/shared/server-info";

const FALLBACK_NAME = "mdxserve";
// Control characters, which a label shown in a list or a DNS-SD instance name cannot hold.
const CONTROL_CHARACTERS = /\p{Cc}/u;

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

/** The longest prefix of `text` that fits in `maxBytes` of UTF-8, never splitting a character. */
function cutToBytes(text: string, maxBytes: number): string {
	let kept = "";
	for (const character of text) {
		if (byteLength(kept + character) > maxBytes) break;
		kept += character;
	}
	return kept;
}

/**
 * The name a server goes by when `serve --name` is not given: the computer's hostname without
 * a trailing `.local`, cut to 63 bytes.
 */
export function defaultServerName(hostname: string): string {
	const withoutLocal = hostname.trim().replace(/\.local\.?$/i, "");
	const cleaned = [...withoutLocal].filter((character) => !CONTROL_CHARACTERS.test(character));
	const name = cutToBytes(cleaned.join(""), SERVER_NAME_MAX_BYTES).trim();
	return name.length > 0 ? name : FALLBACK_NAME;
}

/** Check a name given with `serve --name`. */
export function parseServerName(
	input: string,
): { kind: "ok"; name: string } | { kind: "error"; message: string } {
	const name = input.trim();
	if (name.length === 0) return { kind: "error", message: "--name must not be empty" };
	if (CONTROL_CHARACTERS.test(name)) {
		return { kind: "error", message: "--name must not contain control characters" };
	}
	if (byteLength(name) > SERVER_NAME_MAX_BYTES) {
		return {
			kind: "error",
			message: `--name must be at most ${SERVER_NAME_MAX_BYTES} bytes of UTF-8; ${JSON.stringify(name)} is ${byteLength(name)}`,
		};
	}
	return { kind: "ok", name };
}
