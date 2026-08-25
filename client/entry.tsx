import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MDXProvider } from "@mdx-js/react";
import { MotionConfig } from "framer-motion";
import { App } from "./App";
import { queryClient } from "./api";
import { mdxComponents } from "./mdx-components";
import { ToastStack } from "./ui/Toast";
import { shellInfo, type Route } from "./router";

function parseInitialRoute(): Route {
	const fallback: Route = { kind: "notfound", path: location.pathname };
	const el = document.getElementById("__mdxserve_route");
	if (!el?.textContent) return fallback;
	const rootCount = Number.parseInt(el.dataset.rootCount ?? "", 10);
	if (Number.isFinite(rootCount)) shellInfo.rootCount = rootCount;
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
	const globalWindow = window as Window & { __mdxserveRoot?: Root };
	const root = (globalWindow.__mdxserveRoot ??= createRoot(rootEl));
	const initialRoute = parseInitialRoute();

	root.render(
		<QueryClientProvider client={queryClient}>
			<MotionConfig reducedMotion="user">
				<MDXProvider components={mdxComponents}>
					<App initialRoute={initialRoute} />
				</MDXProvider>
				<ToastStack />
			</MotionConfig>
		</QueryClientProvider>,
	);
}

main();

if (import.meta.hot) {
	import.meta.hot.accept();
}
