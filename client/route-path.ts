/**
 * A pathname straight from `URL.pathname` / `location.pathname` is
 * percent-encoded (`/docs/My%20Page.md`), while the server embeds the decoded
 * form in the initial route and every API takes decoded filesystem paths.
 * Routes created on the client go through this so `route.path` is always the
 * decoded form. A stray `%` that is not a valid escape is kept as-is rather
 * than thrown on.
 */
export function decodeRoutePath(pathname: string): string {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return pathname;
	}
}
