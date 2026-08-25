import { createRoot } from "react-dom/client";
import { MDXProvider } from "@mdx-js/react";
import { MotionConfig } from "framer-motion";
import type { ComponentType } from "react";
import { mdxComponentsBase } from "./mdx-components-base";
import { docModuleCache } from "./doc-module-cache";
import { StandaloneShell } from "./shell/StandaloneShell";

/**
 * What `mdxserve export` embeds as `#__mdxserve_route` JSON, read back by
 * readMeta() below. `mtime` is omitted when the source file's mtime is
 * unavailable at build time.
 */
export interface StandaloneMeta {
	/** An opaque key (the file name, never an absolute path — the file gets shared) for docModuleCache/TOC/DocContext. */
	path: string;
	label: string;
	mtime?: number;
}

/** Parses the `#__mdxserve_route` script tag the same way entry.tsx does. */
export function readMeta(): StandaloneMeta {
	const el = document.getElementById("__mdxserve_route");
	try {
		return JSON.parse(el?.textContent ?? "{}") as StandaloneMeta;
	} catch {
		return { path: "", label: document.title };
	}
}

/**
 * Entry point for a `mdxserve export` output. The bundler's virtual entry
 * plugin (src/rendering/bundle.ts) generates a module that imports the
 * compiled doc component and calls `mount(Doc, readMeta())` — keep both
 * export names and this signature stable, since that generated import is not
 * type-checked against this file.
 */
export function mount(Doc: ComponentType, meta: StandaloneMeta): void {
	const rootEl = document.getElementById("root");
	if (!rootEl) return;
	// DocView reads the module from the router's cache; seed it with the doc
	// that was compiled into this file so it renders synchronously.
	docModuleCache.set(meta.path, { status: "ok", Component: Doc });
	createRoot(rootEl).render(
		<MotionConfig reducedMotion="user">
			<MDXProvider components={mdxComponentsBase}>
				<StandaloneShell meta={meta} />
			</MDXProvider>
		</MotionConfig>,
	);
}
