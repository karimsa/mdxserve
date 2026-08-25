import fsp from "node:fs/promises";
import path from "node:path";
import { renderDocument } from "../http/html.js";
import { escapeForInlineScript } from "../http/shell.js";
import type { BundleOutput } from "../rendering/protocol.js";

export interface ExportHtmlInput {
	docPath: string;
	mtime: number;
	bundle: BundleOutput;
	pkgRoot: string;
}

export interface ExportHtmlOutput {
	contents: string;
	extension: "html";
}

// In minified output these only ever land inside string literals, where
// `\/` and `\!` are identity escapes — the script still parses correctly.
function escapeInlineScriptBody(js: string): string {
	return js.replace(/<\/script/gi, "<\\/script").replaceAll("<!--", "<\\!--");
}

function escapeInlineStyleBody(css: string): string {
	return css.replace(/<\/style/gi, "<\\/style");
}

/** Assemble the built doc's `js`/`css` and its route metadata into one self-contained HTML file. */
export async function exportHtml(input: ExportHtmlInput): Promise<ExportHtmlOutput> {
	const { docPath, mtime, bundle, pkgRoot } = input;
	const label = path.basename(docPath);

	// `path` is only a cache key to the standalone shell (docModuleCache, TOC,
	// DocContext), so it carries the file name rather than the absolute path —
	// an exported file gets shared, and must not leak a username or repo layout.
	const routeJson = escapeForInlineScript(JSON.stringify({ path: label, label, mtime }));
	const js = escapeInlineScriptBody(bundle.js);
	const css = escapeInlineStyleBody(bundle.css);

	const body = `    <div id="root"></div>
    <script id="__mdxserve_route" type="application/json">${routeJson}</script>
    <script>${js}</script>`;

	const faviconSvg = await fsp.readFile(path.join(pkgRoot, "client", "favicon.svg"));
	const faviconHref = `data:image/svg+xml;base64,${faviconSvg.toString("base64")}`;

	const contents = renderDocument({ title: label, body, inlineCss: css, faviconHref });
	return { contents, extension: "html" };
}
