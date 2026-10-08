import path from "node:path";
import { toPosix } from "../infra/paths.js";

/** The generated Tailwind entry CSS's text for a given set of source directories. */
export function renderAppCss(options: {
	sourceDirs: string[];
	/** Individual files to scan on top of the directories (an export's imports from outside the doc's folder). */
	sourceFiles?: string[];
	/** Absolute path of tailwindcss/index.css. */
	tailwindCss: string;
	/** Absolute path of the package's client/ directory. */
	clientDir: string;
}): string {
	const { sourceDirs, sourceFiles = [], tailwindCss, clientDir } = options;

	// Tailwind v4's @import/@plugin resolution walks up from the CSS file's
	// own directory, which won't reach mdxserve's node_modules from a temp
	// dir — so point directly at the package's own copies.
	const designCssPath = path.join(clientDir, "app.css");

	const dirSources = sourceDirs
		.map(
			(dir) => `@source "${toPosix(dir)}/**/*.{md,mdx,js,jsx,ts,tsx}";
@source not "${toPosix(dir)}/**/.{git,mdxserve,venv,cache}/**";
@source not "${toPosix(dir)}/**/{node_modules,venv,dist,build,target,__pycache__}/**";`,
		)
		.join("\n");
	const fileSources = sourceFiles.map((file) => `@source "${toPosix(file)}";`).join("\n");

	// src/ is not published, so it is deliberately not scanned: any Tailwind class used
	// from src/ (e.g. BODY_CLASS in src/http/html.ts) must also appear somewhere under client/.
	// @import (rather than inlining) the package's own app.css so edits to it
	// are tracked as a real CSS dependency and hot-reload without a restart.
	// Zero source directories is a valid input — dirSources is just empty then,
	// and the rest of the file still compiles.
	return `@import "${toPosix(tailwindCss)}";
@import "${toPosix(designCssPath)}";
${dirSources}
${fileSources}
@source "${toPosix(clientDir)}";
`;
}
