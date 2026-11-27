/**
 * The origin a reader means by what they typed or scanned: `https://host[:port]` or
 * `http://host:port`. Anything after the origin (a path, a query, a fragment) is dropped, and
 * text with no scheme is taken as `https://`, which is what `tailscale serve` publishes.
 */
export type OriginResult = { kind: "ok"; origin: string } | { kind: "error"; message: string };

export function normaliseOrigin(input: string): OriginResult {
	const text = input.trim();
	if (text.length === 0) return { kind: "error", message: "Type the server's address." };
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return { kind: "error", message: `${text} is not a web address.` };
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return { kind: "error", message: "The address must start with https:// or http://." };
	}
	if (url.hostname.length === 0) {
		return { kind: "error", message: `${text} has no host name.` };
	}
	if (url.username !== "" || url.password !== "") {
		return { kind: "error", message: "The address must not hold a user name or password." };
	}
	return { kind: "ok", origin: `${url.protocol}//${url.host}` };
}
