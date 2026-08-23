import { motion } from "framer-motion";
import { useLayoutEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { fadeRise } from "./motion";
import { docModuleCache, type Route } from "./router";
import { ResizeHandle } from "./ui/ResizeHandle";
import { DOC_MAX_WIDTH, DOC_MIN_WIDTH, docWidthAtom } from "./state";

function ErrorBox({ message }: { message: string }) {
	return (
		<motion.div
			variants={fadeRise}
			initial="initial"
			animate="enter"
			className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
		>
			<p className="mb-2 font-semibold">Failed to render this page</p>
			<pre className="whitespace-pre-wrap break-words font-mono text-xs">{message}</pre>
		</motion.div>
	);
}

export function DocView({
	route,
	onRendered,
}: {
	route: Extract<Route, { kind: "doc" }>;
	/**
	 * Fired once the article for the *current* cached module is on the page —
	 * keyed on the cached entry's identity (not just route.path) so it fires
	 * exactly once per resolved module, including the async case where the
	 * initial server-rendered route's module is still importing on mount (see
	 * the bootstrap effect in client/router.ts). Lets TocRail/useToc know when
	 * it's safe to re-scan the DOM for headings.
	 */
	onRendered?: () => void;
}) {
	const cached = docModuleCache.get(route.path);
	const setWidth = useSetAtom(docWidthAtom);
	const container = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		if (cached?.status === "ok") onRendered?.();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cached, onRendered]);

	// The router always resolves the module before setting a "doc" route (see
	// client/router.ts loadRoute / the initial-route bootstrap effect), so this
	// is only ever transiently empty on the very first render after boot.
	if (!cached) return null;

	if (cached.status === "error") {
		return <ErrorBox message={cached.message} />;
	}

	const Content = cached.Component;
	return (
		<div ref={container} className="relative">
			<ResizeHandle
				side="left"
				container={container}
				onResize={setWidth}
				label="Resize page"
				minWidth={DOC_MIN_WIDTH}
				maxWidth={DOC_MAX_WIDTH}
			/>
			<ResizeHandle
				side="right"
				container={container}
				onResize={setWidth}
				label="Resize page"
				minWidth={DOC_MIN_WIDTH}
				maxWidth={DOC_MAX_WIDTH}
			/>
			<article className="mdx-prose min-w-0 max-w-full">
				<Content />
			</article>
		</div>
	);
}
