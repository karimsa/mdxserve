import { motion } from "framer-motion";
import { useAtomValue } from "jotai";
import { useCallback, useRef, useState } from "react";
import { DocView } from "../DocView";
import { fadeRise } from "../motion";
import { useTheme } from "../theme";
import { docModuleCache } from "../doc-module-cache";
import { docWidthAtom } from "../state";
import { Footer } from "./Footer";
import { TocRail } from "./TocRail";
import { TopBar } from "./TopBar";
import { useContentWidth, useDocMaxWidth } from "./use-doc-width";
import type { StandaloneMeta } from "../standalone-entry";

/**
 * The shell rendered by a `mdxserve export` output: one doc, no server. A
 * pared-down `AppShell` — same width spring, resize handles, TOC rail, and
 * enter animation, but no sidebar, search, breadcrumb, prev/next, or route
 * transitions (there is only ever one route, baked in at build time).
 */
export function StandaloneShell({ meta }: { meta: StandaloneMeta }) {
	const { theme, toggle } = useTheme();
	const [tocVersion, setTocVersion] = useState(0);
	const docWidth = useAtomValue(docWidthAtom);
	const contentRef = useRef<HTMLDivElement>(null);
	const contentWidth = useContentWidth(contentRef);
	const docMaxWidth = useDocMaxWidth(contentWidth, docWidth);

	// Mirrors AppShell's bumpTocVersion: re-scan headings once the article is
	// on the page, and honour a #hash the browser jumped past before it existed.
	const bumpTocVersion = useCallback(() => {
		setTocVersion((version) => version + 1);
		const hash = window.location.hash.slice(1);
		if (hash) {
			document
				.getElementById(decodeURIComponent(hash))
				?.scrollIntoView({ block: "start", behavior: "instant" });
		}
	}, []);

	return (
		<div className="min-h-screen bg-surface-page">
			<TopBar theme={theme} onToggleTheme={toggle} hostLabel={meta.label} />
			<main className="flex flex-1 min-w-0 px-8 pt-10 pb-24">
				<div ref={contentRef} data-content-area className="flex flex-1 min-w-0 justify-center">
					<motion.div
						variants={fadeRise}
						initial="initial"
						animate="enter"
						className={docMaxWidth ? "w-full" : "w-full max-w-prose"}
						style={docMaxWidth ? { maxWidth: docMaxWidth } : undefined}
					>
						<DocView
							path={meta.path}
							module={docModuleCache.get(meta.path)}
							onRendered={bumpTocVersion}
						/>
						<Footer label={meta.label} mtime={meta.mtime} />
					</motion.div>
				</div>
				<TocRail path={meta.path} version={tocVersion} />
			</main>
		</div>
	);
}
