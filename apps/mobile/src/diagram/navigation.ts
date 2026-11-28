/**
 * Whether the diagram WebView may load `url`: only the diagram page itself, by its exact URI.
 * Every other navigation (a link in a diagram, a redirect, `about:blank`) goes nowhere.
 */
export function allowsNavigation(url: string, pageUri: string): boolean {
	return url === pageUri;
}
