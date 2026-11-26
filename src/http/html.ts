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
	metadata?: DocumentMetadata;
}): string {
	const { title, body, bodyClass = BODY_CLASS, metadata } = options;
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
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>${escapeHtml(metadata?.title ?? title)}</title>
    ${metadataTags}
    <link rel="icon" type="image/svg+xml" href="/__mdxserve/favicon.svg" />
    <script>${THEME_SCRIPT}</script>
    <link rel="stylesheet" href="/__mdxserve/app.css" />
  </head>
  <body class="${bodyClass}">
${body}
  </body>
</html>
`;
}
