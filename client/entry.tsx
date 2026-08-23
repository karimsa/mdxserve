import { createRoot, type Root } from "react-dom/client";
import { MDXProvider } from "@mdx-js/react";
import { MotionConfig } from "framer-motion";
import { App } from "./App";
import { Figure, Pre } from "./CodeBlock";
import { builtinComponents } from "./builtins/index";
import type { Route } from "./router";

function parseInitialRoute(): Route {
	const fallback: Route = { kind: "notfound", path: location.pathname, rootName: "" };
	const el = document.getElementById("__mdxserve_route");
	if (!el?.textContent) return fallback;
	try {
		return JSON.parse(el.textContent) as Route;
	} catch {
		return fallback;
	}
}

function main() {
	const rootEl = document.getElementById("root");
	if (!rootEl) return;

	// Reuse the root across HMR re-executions of this module (self-accepting
	// below) instead of calling createRoot twice on the same container.
	const w = window as Window & { __mdxserveRoot?: Root };
	const root = (w.__mdxserveRoot ??= createRoot(rootEl));
	const initialRoute = parseInitialRoute();

	root.render(
		<MotionConfig reducedMotion="user">
			<MDXProvider components={{ ...builtinComponents, pre: Pre, figure: Figure }}>
				<App initialRoute={initialRoute} />
			</MDXProvider>
		</MotionConfig>,
	);
}

main();

if (import.meta.hot) {
	import.meta.hot.accept();
}
