// The diagram page's own script, inlined as text into the page by build.js after mermaid.min.js
// and zoom.js. Plain browser JavaScript: no imports, nothing from the app's bundle. The app calls
// window.mdxserveDiagram.render(request) through injectJavaScript once the page posts "ready",
// and window.mdxserveDiagram.zoom(action) for the zoom controls; it reads what the page posts
// back with src/diagram/messages.ts.
(function () {
	const host = document.getElementById("host");
	function post(message) {
		window.ReactNativeWebView.postMessage(JSON.stringify(message));
	}
	function textOf(svg, tag, limit) {
		const element = svg.querySelector(":scope > " + tag);
		return element && element.textContent ? element.textContent.slice(0, limit) : null;
	}

	// Zoom: the drawing's own box, and the zoom state (zoom.js) shown through the SVG's viewBox,
	// so WebKit redraws the vector sharp at every zoom.
	let drawing = null;
	let base = null;
	let view = { scale: 1, centerX: 0.5, centerY: 0.5 };
	function visibleBox() {
		const width = base.width / view.scale;
		const height = base.height / view.scale;
		return {
			x: base.x + view.centerX * base.width - width / 2,
			y: base.y + view.centerY * base.height - height / 2,
			width,
			height,
		};
	}
	function apply() {
		if (!drawing || !base) return;
		const visible = visibleBox();
		drawing.setAttribute(
			"viewBox",
			[visible.x, visible.y, visible.width, visible.height].join(" "),
		);
	}
	function change(action, report) {
		const before = view;
		view = mdxserveZoom(view, action);
		apply();
		const fitted = mdxserveZoomFitted(view);
		if (report || view.scale !== before.scale || fitted !== mdxserveZoomFitted(before))
			post({ kind: "zoom", scale: view.scale, fitted });
	}
	/** Points per unit of the drawing at the current zoom, and where the visible part starts. */
	function layout() {
		const bounds = drawing.getBoundingClientRect();
		const visible = visibleBox();
		const pixels = Math.min(bounds.width / visible.width, bounds.height / visible.height);
		return {
			pixels,
			left: bounds.left + (bounds.width - visible.width * pixels) / 2,
			top: bounds.top + (bounds.height - visible.height * pixels) / 2,
			visible,
		};
	}
	/** A point on screen in the drawing's box (0 to 1 across it). */
	function boxPoint(clientX, clientY) {
		const measured = layout();
		return {
			x: (measured.visible.x + (clientX - measured.left) / measured.pixels - base.x) / base.width,
			y: (measured.visible.y + (clientY - measured.top) / measured.pixels - base.y) / base.height,
		};
	}
	function zoom(action) {
		if (drawing && base) change(action, true);
	}

	// Touches reach the page only where the app lets them: always in the full view, and inline
	// only once the diagram is zoomed or moved, so a drag on a fitted diagram scrolls the
	// document.
	let gesture = null;
	function startGesture(touches) {
		gesture = null;
		if (!drawing || !base) return;
		if (touches.length === 1) {
			gesture = { kind: "pan", x: touches[0].clientX, y: touches[0].clientY };
		} else if (touches.length >= 2) {
			const first = touches[0];
			const second = touches[1];
			gesture = {
				kind: "pinch",
				distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
			};
		}
	}
	host.addEventListener("touchstart", (event) => startGesture(event.touches), { passive: true });
	host.addEventListener(
		"touchmove",
		(event) => {
			if (!gesture || !drawing || !base) return;
			event.preventDefault();
			const touches = event.touches;
			if (gesture.kind === "pan" && touches.length === 1) {
				const pixels = layout().pixels;
				const touch = touches[0];
				change({
					kind: "pan",
					dx: (touch.clientX - gesture.x) / pixels / base.width,
					dy: (touch.clientY - gesture.y) / pixels / base.height,
				});
				gesture = { kind: "pan", x: touch.clientX, y: touch.clientY };
			} else if (gesture.kind === "pinch" && touches.length >= 2) {
				const first = touches[0];
				const second = touches[1];
				const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
				if (gesture.distance > 0 && distance > 0) {
					const focus = boxPoint(
						(first.clientX + second.clientX) / 2,
						(first.clientY + second.clientY) / 2,
					);
					change({
						kind: "zoom",
						factor: distance / gesture.distance,
						focusX: focus.x,
						focusY: focus.y,
					});
				}
				gesture = { kind: "pinch", distance };
			} else {
				startGesture(touches);
			}
		},
		{ passive: false },
	);
	host.addEventListener("touchend", (event) => startGesture(event.touches));
	host.addEventListener("touchcancel", () => {
		gesture = null;
	});

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
			const hasBox = Boolean(box && box.width > 0 && box.height > 0);
			const bounds = svg.getBoundingClientRect();
			const width = hasBox ? box.width : bounds.width;
			const height = hasBox ? box.height : bounds.height;
			svg.removeAttribute("style");
			svg.setAttribute("width", "100%");
			svg.setAttribute("height", "100%");
			// The whole drawing fits the view, however tall, centred: never cropped to fill it.
			svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
			drawing = svg;
			base =
				width > 0 && height > 0
					? { x: hasBox ? box.x : 0, y: hasBox ? box.y : 0, width, height }
					: null;
			// A new drawing starts fitted.
			view = mdxserveZoom(view, { kind: "reset" });
			apply();
			post({
				kind: "rendered",
				token: request.token,
				width,
				height,
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
	window.mdxserveDiagram = { render, zoom };
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
