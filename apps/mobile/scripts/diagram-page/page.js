// The diagram page's own script, inlined as text into the page by build.js after mermaid.min.js.
// Plain browser JavaScript: no imports, nothing from the app's bundle. The app calls
// window.mdxserveDiagram.render(request) through injectJavaScript once the page posts "ready",
// and reads what the page posts back with src/diagram/messages.ts.
(function () {
	const host = document.getElementById("host");
	function post(message) {
		window.ReactNativeWebView.postMessage(JSON.stringify(message));
	}
	function textOf(svg, tag, limit) {
		const element = svg.querySelector(":scope > " + tag);
		return element && element.textContent ? element.textContent.slice(0, limit) : null;
	}
	let latest = -1;
	async function render(request) {
		latest = request.token;
		const renderId = "diagram-" + request.token;
		try {
			window.mermaid.initialize({
				startOnLoad: false,
				theme: "base",
				themeVariables: request.themeVariables,
				securityLevel: "strict",
			});
			const result = await window.mermaid.render(renderId, request.source);
			// A newer request owns the host.
			if (request.token !== latest) return;
			host.innerHTML = result.svg;
			const svg = host.querySelector("svg");
			const box = svg.viewBox && svg.viewBox.baseVal;
			const bounds = svg.getBoundingClientRect();
			svg.removeAttribute("style");
			svg.setAttribute("width", "100%");
			svg.setAttribute("height", "100%");
			post({
				kind: "rendered",
				token: request.token,
				width: box && box.width > 0 ? box.width : bounds.width,
				height: box && box.height > 0 ? box.height : bounds.height,
				title: textOf(svg, "title", 500),
				description: textOf(svg, "desc", 2000),
			});
		} catch (error) {
			// Mermaid 10.9 leaves its temporary element behind when a render throws
			// (apps/web/src/Mermaid.tsx removes it the same way).
			const leftover = document.getElementById("d" + renderId);
			if (leftover) leftover.remove();
			if (request.token !== latest) return;
			post({
				kind: "error",
				token: request.token,
				message: String(error && error.message ? error.message : error).slice(0, 2000),
			});
		}
	}
	window.mdxserveDiagram = { render };
	// Mermaid measures labels when it renders, so the faces must be loaded first.
	const fonts = Promise.all([
		document.fonts.load("400 16px Manrope"),
		document.fonts.load("700 16px Manrope"),
	]);
	const limit = new Promise((resolve) => setTimeout(resolve, 1500));
	Promise.race([fonts, limit]).then(
		() => post({ kind: "ready" }),
		() => post({ kind: "ready" }),
	);
})();
