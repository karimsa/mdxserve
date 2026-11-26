import path from "node:path";
import { toPosix } from "../infra/paths.js";

/**
 * The generated Tailwind entry CSS's text. Tailwind scans mdxserve's own
 * client/ only: documents cannot use class names, so mounted roots are never
 * scanned.
 */
export function renderAppCss(options: {
	/** Absolute path of tailwindcss/index.css. */
	tailwindCss: string;
	/** Absolute path of the package's client/ directory. */
	clientDir: string;
}): string {
	const { tailwindCss, clientDir } = options;

	// Tailwind v4's @import/@plugin resolution walks up from the CSS file's
	// own directory, which won't reach mdxserve's node_modules from a temp
	// dir — so point directly at the package's own copies.
	const designCssPath = path.join(clientDir, "app.css");

	// src/ is not published, so it is deliberately not scanned: any Tailwind class used
	// from src/ (e.g. BODY_CLASS in src/http/html.ts) must also appear somewhere under client/.
	// @import (rather than inlining) the package's own app.css so edits to it
	// are tracked as a real CSS dependency and hot-reload without a restart.
	return `@import "${toPosix(tailwindCss)}";
@import "${toPosix(designCssPath)}";
@source "${toPosix(clientDir)}";
`;
}
