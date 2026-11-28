// Runs the diagram page in jsdom for tests/mermaid-page*.test.ts. jsdom's dependencies are ES
// modules that jest's CommonJS runtime cannot load, so the tests run this file with node and
// read the JSON it prints.
//
//   node page-dom.js inspect            the built page's scripts, addresses, policy and style
//   node page-dom.js run <scenario>     the real page.js over a stub Mermaid; what it did
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { buildDiagramPage, readDiagramPageInputs } = require("../../scripts/diagram-page/build.js");

const SVG =
	'<svg viewBox="0 0 420 180" style="max-width: 420px"><title>Login</title><desc>The app asks</desc><g></g></svg>';

function inspect() {
	const page = new JSDOM(buildDiagramPage(readDiagramPageInputs())).window.document;
	return {
		scripts: [...page.querySelectorAll("script")].map((script) => ({
			hasSrc: script.hasAttribute("src"),
			text: script.textContent,
		})),
		withAddress: page.querySelectorAll("[src], [href]").length,
		policy:
			page.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ??
			null,
		style: page.querySelector("style")?.textContent ?? "",
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

async function run(scenario) {
	const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', {
		runScripts: "outside-only",
	});
	const { window } = dom;
	const posted = [];
	const initialized = [];
	let release = () => {};
	const overtaken = new Promise((resolve) => {
		release = resolve;
	});
	const renders = {
		draws: async () => ({ svg: SVG }),
		throws: async (id) => {
			const leftover = window.document.createElement("div");
			leftover.id = `d${id}`;
			window.document.body.append(leftover);
			throw new Error("Parse error on line 2");
		},
		overtaken: (id) => (id === "diagram-1" ? overtaken : Promise.resolve({ svg: SVG })),
	};
	window.ReactNativeWebView = { postMessage: (data) => posted.push(JSON.parse(data)) };
	window.mermaid = { initialize: (config) => initialized.push(config), render: renders[scenario] };
	Object.defineProperty(window.document, "fonts", { value: { load: () => Promise.resolve([]) } });
	window.eval(fs.readFileSync(path.join(__dirname, "../../scripts/diagram-page/page.js"), "utf8"));
	await settle();
	const api = window.mdxserveDiagram;
	if (scenario === "overtaken") {
		const first = api.render({ token: 1, source: "a", themeVariables: {} });
		await api.render({ token: 2, source: "b", themeVariables: {} });
		release({ svg: SVG });
		await first;
	} else {
		await api.render({
			token: 1,
			source: "flowchart LR\n A-->B",
			themeVariables: { primaryColor: "#e8f6f5" },
		});
	}
	const svg = window.document.querySelector("#host > svg");
	return {
		posted,
		initialized,
		svg: svg && { width: svg.getAttribute("width"), hasStyle: svg.hasAttribute("style") },
		leftover: window.document.getElementById("ddiagram-1") !== null,
	};
}

async function main() {
	const [mode, scenario] = process.argv.slice(2);
	const result = mode === "inspect" ? inspect() : await run(scenario);
	process.stdout.write(JSON.stringify(result));
}

void main();
