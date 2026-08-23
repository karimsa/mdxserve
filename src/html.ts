export function escapeHtml(input: string): string {
	return input
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

const BODY_CLASS = "bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 min-h-screen";

export function renderDocument(options: {
	title: string;
	body: string;
	bodyClass?: string;
}): string {
	const { title, body, bodyClass = BODY_CLASS } = options;
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/__mdxserve/app.css" />
  </head>
  <body class="${bodyClass}">
${body}
  </body>
</html>
`;
}
