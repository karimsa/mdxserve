// Builds the page the app's diagram WebView loads (src/diagram/DiagramWebView.tsx): one HTML
// file holding the installed mermaid.min.js, two Manrope faces and the page's own script
// (zoom.js and page.js beside this file), under a Content-Security-Policy that allows those two scripts by
// hash and no network at all. metro.config.js and jest's global setup write it to
// assets/generated/diagram.html, which is gitignored; Metro bundles it as an asset.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "../..");

/** Where writeDiagramPage() puts the page; src/diagram/diagram-page.ts requires it. */
const diagramPagePath = path.join(appRoot, "assets/generated/diagram.html");

/** The text inside a `<script>` element that the HTML parser reacts to, and its escaped form. */
const ESCAPES = [
	{ pattern: /<\/script/gi, escaped: /<\\\/script/gi, from: "</", to: "<\\/" },
	{ pattern: /<!--/g, escaped: /<\\!--/g, from: "<!", to: "<\\!" },
];

/**
 * `source` safe to place inside a `<script>` element: `</script` becomes `<\/script` and
 * `<!--` becomes `<\!--`, which mean the same in a string literal and a regular expression.
 * Throws when `source` already holds an escaped form, so unescapeScript() undoes this exactly.
 */
function escapeScript(source) {
	for (const { escaped } of ESCAPES) {
		escaped.lastIndex = 0;
		if (escaped.test(source)) throw new Error(`Script already contains ${escaped.source}`);
	}
	let result = source;
	for (const { pattern, from, to } of ESCAPES)
		result = result.replace(pattern, (match) => to + match.slice(from.length));
	return result;
}

/** escapeScript() undone. */
function unescapeScript(escapedSource) {
	let result = escapedSource;
	for (const { escaped, from, to } of ESCAPES)
		result = result.replace(escaped, (match) => from + match.slice(to.length));
	return result;
}

function sha256(text) {
	return crypto.createHash("sha256").update(text, "utf8").digest("base64");
}

/**
 * The page's HTML. `mermaidSource` and `pageScript` are JavaScript source text; `fonts` holds
 * the base64 of Manrope's regular (400) and bold (700) TrueType files.
 */
function buildDiagramPage({ mermaidSource, pageScript, fonts }) {
	const scripts = [escapeScript(mermaidSource), escapeScript(pageScript)];
	const policy = [
		"default-src 'none'",
		`script-src ${scripts.map((script) => `'sha256-${sha256(script)}'`).join(" ")}`,
		"style-src 'unsafe-inline'",
		"img-src data:",
		"font-src data:",
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");
	return [
		"<!doctype html>",
		'<html lang="en">',
		"<head>",
		'<meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="${policy}">`,
		'<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
		"<style>",
		`@font-face { font-family: Manrope; font-weight: 400; src: url(data:font/ttf;base64,${fonts.regular}) format("truetype"); }`,
		`@font-face { font-family: Manrope; font-weight: 700; src: url(data:font/ttf;base64,${fonts.bold}) format("truetype"); }`,
		"html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; -webkit-user-select: none; -webkit-touch-callout: none; }",
		// The page zooms the drawing itself (zoom.js), so touches are its own, not WebKit's.
		"#host { width: 100%; height: 100%; touch-action: none; }",
		"#host > svg { display: block; width: 100%; height: 100%; max-width: none !important; }",
		"</style>",
		"</head>",
		"<body>",
		'<div id="host"></div>',
		`<script>${scripts[0]}</script>`,
		`<script>${scripts[1]}</script>`,
		"</body>",
		"</html>",
		"",
	].join("\n");
}

/** The inputs buildDiagramPage() takes, read from the installed packages and page.js. */
function readDiagramPageInputs() {
	const resolve = (request) => require.resolve(request, { paths: [appRoot] });
	const font = (request) => fs.readFileSync(resolve(request)).toString("base64");
	return {
		mermaidSource: fs.readFileSync(resolve("mermaid/dist/mermaid.min.js"), "utf8"),
		pageScript: ["zoom.js", "page.js"]
			.map((file) => fs.readFileSync(path.join(__dirname, file), "utf8"))
			.join("\n"),
		fonts: {
			regular: font("@expo-google-fonts/manrope/400Regular/Manrope_400Regular.ttf"),
			bold: font("@expo-google-fonts/manrope/700Bold/Manrope_700Bold.ttf"),
		},
	};
}

/**
 * Writes the page to diagramPagePath, only when its bytes differ from the file there, so an
 * unchanged page leaves Metro's cache and file watcher alone.
 */
function writeDiagramPage() {
	const html = buildDiagramPage(readDiagramPageInputs());
	let current = null;
	try {
		current = fs.readFileSync(diagramPagePath, "utf8");
	} catch {
		// No page yet.
	}
	if (current === html) return;
	fs.mkdirSync(path.dirname(diagramPagePath), { recursive: true });
	fs.writeFileSync(diagramPagePath, html);
}

module.exports = {
	buildDiagramPage,
	diagramPagePath,
	escapeScript,
	readDiagramPageInputs,
	unescapeScript,
	writeDiagramPage,
};
