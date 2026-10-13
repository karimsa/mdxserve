import type { DocumentMetadata } from "../docs/metadata.js";

export function escapeHtml(input: string): string {
	return input
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

const BODY_CLASS = "bg-surface-page text-text-body min-h-screen";

/**
 * Runs before the stylesheet so the first paint already carries the right
 * `data-theme`. Mirrors client/theme.ts: an explicit choice in localStorage
 * wins, otherwise follow the OS. Kept dependency-free and tiny on purpose.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("mdxserve-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;

export function renderDocument(options: {
	title: string;
	body: string;
	bodyClass?: string;
	/** Emit `<style>${inlineCss}</style>` instead of the `/__mdxserve/app.css` stylesheet link — used by `mdxserve export`, which ships no server to fetch it from. */
	inlineCss?: string;
	/** Overrides the `/__mdxserve/favicon.svg` icon href — `mdxserve export` passes a data URI since there is no server to serve the file from. */
	faviconHref?: string;
	metadata?: DocumentMetadata;
}): string {
	const {
		title,
		body,
		bodyClass = BODY_CLASS,
		inlineCss,
		faviconHref = "/__mdxserve/favicon.svg",
		metadata,
	} = options;
	const metadataTags = metadata
		? [
				metadata.description === undefined
					? ""
					: `<meta data-mdxserve-metadata name="description" content="${escapeHtml(metadata.description)}" />`,
				metadata.canonical === undefined
					? ""
					: `<link data-mdxserve-metadata rel="canonical" href="${escapeHtml(metadata.canonical)}" />`,
				...metadata.openGraph.map(
					({ property, content }) =>
						`<meta data-mdxserve-metadata property="${escapeHtml(property)}" content="${escapeHtml(content)}" />`,
				),
			]
				.filter(Boolean)
				.join("\n    ")
		: "";
	const styleTag =
		inlineCss === undefined
			? `<link rel="stylesheet" href="/__mdxserve/app.css" />`
			: `<style>${inlineCss}</style>`;
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(metadata?.title ?? title)}</title>
    ${metadataTags}
    <link rel="icon" type="image/svg+xml" href="${faviconHref}" />
    <script>${THEME_SCRIPT}</script>
    ${styleTag}
  </head>
  <body class="${bodyClass}">
${body}
  </body>
</html>
`;
}
