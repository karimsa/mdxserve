import path from "node:path";
import type { Server as HttpServer } from "node:http";
import {
	createServer as createViteServer,
	normalizePath,
	type PluginOption,
	type ViteDevServer,
} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dependencyRoots, getPackageRoot, packageDir, resolveFromPkg } from "../infra/pkg.js";

export interface ViteAlias {
	find: string;
	replacement: string;
}

export interface SharedViteConfig {
	plugins: PluginOption[];
	resolve: { alias: ViteAlias[]; dedupe: string[] };
	/** The client dep-optimizer's `include` list; dev-only concerns (SSR, exclude) live in createDevServer. */
	optimizeDepsInclude: string[];
}

/**
 * The alias list, the React/Tailwind plugin chain, and the client
 * dep-optimizer include list for the dev server (`createDevServer`).
 * Documents are not compiled here: clients read them as JSON.
 */
export function sharedViteConfig(): SharedViteConfig {
	const reactEntry = resolveFromPkg("react");
	const reactDomEntry = resolveFromPkg("react-dom");
	const reactDomClientEntry = resolveFromPkg("react-dom/client");
	const jsxRuntime = resolveFromPkg("react/jsx-runtime");
	const jsxDevRuntime = resolveFromPkg("react/jsx-dev-runtime");
	const mermaidEntry = resolveFromPkg("mermaid");
	// svg-pan-zoom is CJS; alias the package dir (not the browserified dist
	// main) so Vite picks the plain `module.exports` entry and interops it.
	const svgPanZoomEntry = path.dirname(resolveFromPkg("svg-pan-zoom/package.json"));
	// ESM entry: require.resolve("zod") lands on the CJS "main", which
	// Rolldown/esbuild cannot tree-shake — the whole library (incl. ~40
	// locales) would ship. Alias straight to the ESM entry file instead.
	const zodEntry = path.join(packageDir("zod"), "index.js");
	// diff's package.json "main" is its CJS entry (libcjs), so a plain
	// require.resolve("diff") lands there. Unlike svg-pan-zoom/tippy.js (no
	// "exports" map, so aliasing the package dir falls back to the "module"
	// field), diff *does* define a conditional "exports" map — and aliasing to
	// just the package dir still resolves through it to the "require" branch
	// here, landing back on libcjs. Alias straight to the concrete ESM file
	// instead so there's no conditional resolution left to get wrong.
	const diffEntry = path.join(
		path.dirname(resolveFromPkg("diff/package.json")),
		"libesm",
		"index.js",
	);
	// framer-motion's default resolution can land on its CJS entry; alias the
	// package dir (like svg-pan-zoom) so Vite picks the module/exports (ESM)
	// entry instead.
	const framerMotionEntry = path.dirname(resolveFromPkg("framer-motion/package.json"));
	// react-hot-toast ships an "exports" map with an ESM branch; alias the
	// package dir (like date-fns) so the optimizer's include entry resolves from
	// the neutral Vite root at all — without an alias it logs "Failed to resolve
	// dependency" and only works by accident of discovery from client/.
	const reactHotToastEntry = path.dirname(resolveFromPkg("react-hot-toast/package.json"));
	// tippy.js must be aliased to its package dir (not just resolved to its CJS
	// `main`) so subpath imports like "tippy.js/dist/tippy.css" resolve too.
	const tippyEntry = path.dirname(resolveFromPkg("tippy.js/package.json"));
	// @tippyjs/react's `main` is a UMD/CJS bundle (dist/tippy-react.umd.js);
	// alias the package dir so Vite's own resolver picks the `module` (ESM)
	// entry instead, same as framer-motion/svg-pan-zoom above.
	const tippyReactEntry = path.dirname(resolveFromPkg("@tippyjs/react/package.json"));
	// lucide-react's `main` is CJS with no "exports" map; alias the package dir
	// so deep subpath imports (lucide-react/dist/esm/icons/<name>.mjs,
	// lucide-react/dynamicIconImports) resolve. Nothing imports the bare
	// "lucide-react" entry at runtime any more — client/ui/Icon.tsx imports
	// chrome icons per file and author icons via dynamicIconImports — so this
	// alias exists only for those subpaths, not for pre-bundling the whole map.
	const lucideEntry = path.dirname(resolveFromPkg("lucide-react/package.json"));
	// date-fns (listing + footer relative times) ships an "exports" map with an
	// ESM branch; aliasing the package dir lets Vite's resolver pick it.
	const dateFnsEntry = path.dirname(resolveFromPkg("date-fns/package.json"));
	// jotai (the single-open-section atom read by MdSection) has no "main"/"module"
	// ESM default and its subpaths (jotai/utils, and jotai/vanilla + jotai/react
	// re-exported from within its own entry) all need to keep resolving through
	// its "exports" map — alias the package dir, same as tippy.js/lucide-react
	// above, so subpath imports keep working and Vite's resolver (not a fixed
	// file) picks the ESM branch.
	const jotaiEntry = path.dirname(resolveFromPkg("jotai/package.json"));
	// Tiptap (the section editor, client/MdSectionEditor.tsx) is behind a
	// React.lazy import, so without this Vite would only discover it on the
	// first edit — then re-optimise ~50 packages and full-reload the page
	// mid-edit. And because Vite's root here is a fresh temp dir per start, the
	// dep cache never survives a restart, so that stall would recur every
	// launch. Pre-bundle the directly-imported packages at startup instead.
	// Their package.json isn't in their "exports" map, hence packageDir().
	const tiptapPackages = [
		"@tiptap/core",
		"@tiptap/react",
		"@tiptap/starter-kit",
		"@tiptap/markdown",
		"@tiptap/extension-list",
		"@tiptap/extension-table",
		"@tiptap/extension-image",
		"@tiptap/suggestion",
	];
	const tiptapAliases = tiptapPackages.map((name) => ({
		find: name,
		replacement: packageDir(name),
	}));
	// @tiptap/pm has no bare export; resolve a subpath to locate its package
	// directory so its state, view and history imports share the optimizer.
	const tiptapPmEntry = path.resolve(resolveFromPkg("@tiptap/pm/state"), "../../..");
	// The lazy editor also imports these parsers directly. When mdxserve is
	// installed under node_modules, Vite skips dependency discovery for its
	// client files, so they must be resolved and optimized explicitly.
	const editorParserPackages = [
		"mdast-util-from-markdown",
		"mdast-util-mdx",
		"micromark-extension-mdxjs",
	];
	const editorParserAliases = editorParserPackages.map((name) => ({
		find: name,
		replacement: packageDir(name),
	}));
	const reactQueryEntry = path.dirname(resolveFromPkg("@tanstack/react-query/package.json"));
	const trpcClientEntry = path.dirname(resolveFromPkg("@trpc/client/package.json"));
	const trpcTanstackReactQueryEntry = path.dirname(
		resolveFromPkg("@trpc/tanstack-react-query/package.json"),
	);
	// @trpc/client pulls runtime helpers (error shapes, transformer types) from
	// @trpc/server/unstable-core-do-not-import, so @trpc/server must be
	// aliased too even though it looks server-only.
	const trpcServerEntry = path.dirname(resolveFromPkg("@trpc/server/package.json"));
	// client/realtime.ts. Aliased to the package dir (like react-hot-toast) so
	// the optimizer's include entry resolves from the neutral Vite root and its
	// "exports" map picks the ESM build.
	const socketIoClientEntry = path.dirname(resolveFromPkg("socket.io-client/package.json"));

	// shiki's subpaths map to single files in its "exports"; alias each one so
	// the lazy highlighter is pre-bundled at startup rather than discovered
	// (and the page reloaded) on the first code block.
	const shikiDist = path.join(packageDir("shiki"), "dist");
	const shikiAliases: ViteAlias[] = [
		{ find: "shiki/core", replacement: path.join(shikiDist, "core.mjs") },
		{ find: "shiki/engine/javascript", replacement: path.join(shikiDist, "engine-javascript.mjs") },
		{ find: "shiki/langs", replacement: path.join(shikiDist, "langs.mjs") },
	];

	// Vite/rollup-plugin-alias matches on a "find" prefix (id === find or
	// id.startsWith(find + "/")), taking the first match in list order —
	// so subpath aliases like "react/jsx-runtime" MUST be listed before
	// the bare "react" alias, or "react" would prefix-match them first
	// and mangle the replacement (e.g. ".../react/index.js/jsx-runtime").
	const alias: ViteAlias[] = [
		{ find: "react/jsx-runtime", replacement: jsxRuntime },
		{ find: "react/jsx-dev-runtime", replacement: jsxDevRuntime },
		{ find: "react-dom/client", replacement: reactDomClientEntry },
		{ find: "react-dom", replacement: reactDomEntry },
		{ find: "react", replacement: reactEntry },
		{ find: "mermaid", replacement: mermaidEntry },
		{ find: "svg-pan-zoom", replacement: svgPanZoomEntry },
		{ find: "zod", replacement: zodEntry },
		{ find: "diff", replacement: diffEntry },
		{ find: "framer-motion", replacement: framerMotionEntry },
		{ find: "react-hot-toast", replacement: reactHotToastEntry },
		{ find: "@tippyjs/react", replacement: tippyReactEntry },
		{ find: "tippy.js", replacement: tippyEntry },
		{ find: "lucide-react", replacement: lucideEntry },
		{ find: "date-fns", replacement: dateFnsEntry },
		// The UMD entry cannot run directly in the SSR module runner.
		{
			find: "@floating-ui/dom",
			replacement: path.join(packageDir("@floating-ui/dom"), "dist/floating-ui.dom.mjs"),
		},
		{ find: "ms", replacement: resolveFromPkg("ms") },
		{ find: "bytes", replacement: resolveFromPkg("bytes") },
		{ find: "jotai", replacement: jotaiEntry },
		...tiptapAliases,
		{ find: "@tiptap/pm", replacement: tiptapPmEntry },
		...editorParserAliases,
		{ find: "@tanstack/react-query", replacement: reactQueryEntry },
		{ find: "@trpc/client", replacement: trpcClientEntry },
		{ find: "@trpc/tanstack-react-query", replacement: trpcTanstackReactQueryEntry },
		{ find: "@trpc/server", replacement: trpcServerEntry },
		// The code highlighter (client/highlight.ts), imported lazily by subpath.
		// Exact-file aliases, listed before nothing that prefixes them, so the
		// optimizer's include entries resolve from the neutral Vite root.
		...shikiAliases,
		{ find: "socket.io-client", replacement: socketIoClientEntry },
	];

	const plugins: PluginOption[] = [react({ include: /\.(jsx|tsx|js|ts)$/ }), tailwindcss()];

	// lucide-react is deliberately absent: nothing imports the bare entry
	// any more (see the alias comment above), and pre-bundling it here would
	// undo the point of subsetting it in Icon.tsx.
	const optimizeDepsInclude = [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"react/jsx-dev-runtime",
		"mermaid",
		"svg-pan-zoom",
		"zod",
		"framer-motion",
		"ms",
		"bytes",
		"react-hot-toast",
		"@tippyjs/react",
		"tippy.js",
		"diff",
		"date-fns",
		"jotai",
		"jotai/utils",
		...tiptapPackages,
		"@tiptap/pm/state",
		"@tiptap/pm/view",
		"@tiptap/pm/history",
		...editorParserPackages,
		"@tanstack/react-query",
		"@trpc/client",
		"@trpc/tanstack-react-query",
		"@trpc/server",
		...shikiAliases.map((alias) => alias.find),
		"socket.io-client",
	];

	return { plugins, resolve: { alias, dedupe: ["react", "react-dom"] }, optimizeDepsInclude };
}

export interface CreateDevServerOptions {
	/** Every mounted root; each needs its own `fs.allow` entry and watcher. */
	roots: string[];
	/**
	 * Vite's own project root. This is a neutral, generated-CSS temp dir — not
	 * one of the served roots — so every file Vite serves gets a uniform
	 * `/@fs/<abs>` URL instead of some being root-relative.
	 */
	viteRoot: string;
	cacheDir: string;
	httpServer: HttpServer;
	extraFsAllow?: string[];
}

export async function createDevServer(options: CreateDevServerOptions): Promise<ViteDevServer> {
	const { roots, viteRoot, cacheDir, httpServer, extraFsAllow = [] } = options;
	const pkgRoot = getPackageRoot();
	const shared = sharedViteConfig();

	const vite = await createViteServer({
		root: viteRoot,
		configFile: false,
		// Pin the dep-optimizer cache next to the served content instead of letting
		// Vite derive it from the nearest package.json above `root` (which could be
		// an unrelated project). Hidden, so the listing skips it; `mdxserve cache
		// clean` removes it.
		cacheDir,
		logLevel: "warn",
		appType: "custom",
		server: {
			middlewareMode: true,
			// Served roots can be large (a whole repo); keep the watcher away from
			// dependency/venv/build trees and don't follow symlinks out of the root.
			watch: {
				followSymlinks: false,
				ignored: [
					"**/.git/**",
					"**/node_modules/**",
					// Older releases kept the dep cache in-root; skip any leftovers.
					"**/.mdxserve/**",
					"**/.venv/**",
					"**/venv/**",
					"**/.cache/**",
					"**/dist/**",
					"**/build/**",
					"**/target/**",
					"**/__pycache__/**",
					// The save endpoint's atomic-write temp file — never a real edit,
					// so it shouldn't trigger HMR or the listing-changed watcher.
					"**/.*.mdxserve-tmp",
				],
			},
			fs: {
				// cacheDir must be listed explicitly (rather than relying on it being
				// under a served root): optimized deps are served as
				// /@fs/<cacheDir>/deps/…, and with a neutral Vite root nothing else
				// implies it's allowed.
				allow: [
					...roots,
					cacheDir,
					path.join(pkgRoot, "client"),
					// The builtins' prop schemas, which client/ imports.
					path.join(pkgRoot, "shared"),
					...dependencyRoots(pkgRoot),
					...extraFsAllow,
				],
			},
			hmr: { server: httpServer },
		},
		plugins: shared.plugins,
		resolve: shared.resolve,
		optimizeDeps: {
			entries: [],
			include: shared.optimizeDepsInclude,
			// client/ui/Icon.tsx imports chrome icons per file and author icons via
			// lucide-react/dynamicIconImports; nothing imports the bare
			// "lucide-react" entry any more. Excluding it stops Vite from
			// "discovering" each new per-icon deep import mid-session and
			// re-optimizing + full-reloading the page.
			exclude: ["lucide-react"],
		},
	});

	return vite;
}

/**
 * Grant `dir` access under Vite's `fs.allow` on a live dev server, so a
 * newly-mounted root's files become servable via `/@fs/` without a restart.
 *
 * This relies on Vite reading `server.fs.allow` fresh on every request
 * (`isFileLoadingAllowed` in vite's own `server/middlewares/static.ts`
 * consults `server.config.server.fs.allow` at request time, not a value
 * captured once at server creation) — verified against the pinned Vite
 * version in package.json.
 */
export function allowFsDir(vite: ViteDevServer, dir: string): void {
	const normalized = normalizePath(dir);
	const allow = vite.config.server.fs.allow;
	if (!allow.includes(normalized)) allow.push(normalized);
}

/**
 * Revoke `dir`'s `fs.allow` entry (every entry that equals it, in case it was
 * added more than once) and invalidate any module Vite already loaded from
 * under it, so a removed root's files stop being servable immediately rather
 * than staying reachable from the module graph's cache.
 */
export function disallowFsDir(vite: ViteDevServer, dir: string): void {
	const normalized = normalizePath(dir);
	const allow = vite.config.server.fs.allow;
	for (let index = allow.length - 1; index >= 0; index -= 1) {
		if (allow[index] === normalized) allow.splice(index, 1);
	}

	const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
	for (const [file, modules] of vite.moduleGraph.fileToModulesMap) {
		if (file !== normalized && !file.startsWith(prefix)) continue;
		for (const dirModule of modules) vite.moduleGraph.invalidateModule(dirModule);
	}
}
