import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Server as HttpServer } from "node:http";
import { createServer as createViteServer, type PluginOption, type ViteDevServer } from "vite";
import mdx from "@mdx-js/rollup";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { escapeBareLt } from "./mdx/lenient-md.js";
import { mdxCompileOptions } from "./mdx/mdx-options.js";
import { remarkSections } from "./mdx/remark-sections.js";
import { getPackageRoot } from "../infra/pkg.js";

const require = createRequire(import.meta.url);

function resolveFromPkg(specifier: string): string {
	return require.resolve(specifier, { paths: [getPackageRoot()] });
}

/**
 * The on-disk directory of a package whose package.json is not in its
 * "exports" map (so `resolveFromPkg("<name>/package.json")` would throw):
 * resolve its entry file, then walk up to the nearest package.json that
 * actually declares that name (skipping any nested one in a dist/ folder).
 */
function packageDir(name: string): string {
	let dir = path.dirname(resolveFromPkg(name));
	for (;;) {
		const manifest = path.join(dir, "package.json");
		if (fs.existsSync(manifest)) {
			const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")) as { name?: string };
			if (pkg.name === name) return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) throw new Error(`Cannot locate package directory for ${name}`);
		dir = parent;
	}
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

	const reactEntry = resolveFromPkg("react");
	const reactDomEntry = resolveFromPkg("react-dom");
	const reactDomClientEntry = resolveFromPkg("react-dom/client");
	// SSR-only entry, used by src/rendering/render.ts's server-side render check
	// (client/ssr-entry.tsx imports it). Same reasoning as react-dom/client.
	const reactDomServerEntry = resolveFromPkg("react-dom/server");
	const jsxRuntime = resolveFromPkg("react/jsx-runtime");
	const jsxDevRuntime = resolveFromPkg("react/jsx-dev-runtime");
	const mdxReactEntry = resolveFromPkg("@mdx-js/react");
	const mermaidEntry = resolveFromPkg("mermaid");
	// svg-pan-zoom is CJS; alias the package dir (not the browserified dist
	// main) so Vite picks the plain `module.exports` entry and interops it.
	const svgPanZoomEntry = path.dirname(resolveFromPkg("svg-pan-zoom/package.json"));
	const zodEntry = resolveFromPkg("zod");
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
	// tippy.js must be aliased to its package dir (not just resolved to its CJS
	// `main`) so subpath imports like "tippy.js/dist/tippy.css" resolve too.
	const tippyEntry = path.dirname(resolveFromPkg("tippy.js/package.json"));
	// @tippyjs/react's `main` is a UMD/CJS bundle (dist/tippy-react.umd.js);
	// alias the package dir so Vite's own resolver picks the `module` (ESM)
	// entry instead, same as framer-motion/svg-pan-zoom above.
	const tippyReactEntry = path.dirname(resolveFromPkg("@tippyjs/react/package.json"));
	// lucide-react's `main` is CJS with no "exports" map; alias the package dir
	// so Vite picks the `module` (ESM) entry, same as framer-motion above.
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
	// launch. Pre-bundle the six directly-imported packages at startup instead;
	// @tiptap/core, @tiptap/pm/* and marked come along transitively. Their
	// package.json isn't in their "exports" map, hence packageDir().
	const tiptapPackages = [
		"@tiptap/react",
		"@tiptap/starter-kit",
		"@tiptap/markdown",
		"@tiptap/extension-list",
		"@tiptap/extension-table",
		"@tiptap/extension-image",
	];
	const tiptapAliases = tiptapPackages.map((name) => ({
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

	// @mdx-js/rollup must run before @vitejs/plugin-react so that .mdx/.md
	// files are compiled to JSX before the react plugin's babel transform.
	const mdxPlugin = {
		// The compiler options live in mdx-options.ts so the validator shares
		// them; the extension lists are rollup-plugin-only and make .md go through
		// the same MDX path as .mdx. remarkSections is passed only here, not into
		// mdx-options.ts's shared mdxCompileOptions(): the validator must never
		// see an MdSection wrapper, or it would report it as an unregistered
		// component on every doc.
		...mdx({
			...mdxCompileOptions({ remarkPlugins: [remarkSections] }),
			mdxExtensions: [".mdx", ".md"],
			mdExtensions: [],
		}),
		enforce: "pre" as const,
	};

	// Runs ahead of the MDX compiler; see escapeBareLt for why.
	const lenientMdPlugin = {
		name: "mdxserve:lenient-md",
		enforce: "pre" as const,
		transform(code: string, id: string) {
			if (!/\.md(\?|$)/.test(id)) return null;
			const escaped = escapeBareLt(code);
			return escaped === code ? null : { code: escaped, map: null };
		},
	};

	const plugins: PluginOption[] = [
		lenientMdPlugin,
		mdxPlugin,
		react({ include: /\.(mdx|md|jsx|tsx|js|ts)$/ }),
		tailwindcss(),
	];

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
					path.join(pkgRoot, "node_modules"),
					...extraFsAllow,
				],
			},
			hmr: {
				server: httpServer,
			},
		},
		plugins,
		resolve: {
			// Vite/rollup-plugin-alias matches on a "find" prefix (id === find or
			// id.startsWith(find + "/")), taking the first match in list order —
			// so subpath aliases like "react/jsx-runtime" MUST be listed before
			// the bare "react" alias, or "react" would prefix-match them first
			// and mangle the replacement (e.g. ".../react/index.js/jsx-runtime").
			alias: [
				{ find: "react/jsx-runtime", replacement: jsxRuntime },
				{ find: "react/jsx-dev-runtime", replacement: jsxDevRuntime },
				{ find: "react-dom/client", replacement: reactDomClientEntry },
				{ find: "react-dom/server", replacement: reactDomServerEntry },
				{ find: "react-dom", replacement: reactDomEntry },
				{ find: "react", replacement: reactEntry },
				{ find: "@mdx-js/react", replacement: mdxReactEntry },
				{ find: "mermaid", replacement: mermaidEntry },
				{ find: "svg-pan-zoom", replacement: svgPanZoomEntry },
				{ find: "zod", replacement: zodEntry },
				{ find: "diff", replacement: diffEntry },
				{ find: "framer-motion", replacement: framerMotionEntry },
				{ find: "@tippyjs/react", replacement: tippyReactEntry },
				{ find: "tippy.js", replacement: tippyEntry },
				{ find: "lucide-react", replacement: lucideEntry },
				{ find: "date-fns", replacement: dateFnsEntry },
				{ find: "jotai", replacement: jotaiEntry },
				...tiptapAliases,
				{ find: "@tanstack/react-query", replacement: reactQueryEntry },
				{ find: "@trpc/client", replacement: trpcClientEntry },
				{ find: "@trpc/tanstack-react-query", replacement: trpcTanstackReactQueryEntry },
				{ find: "@trpc/server", replacement: trpcServerEntry },
			],
			dedupe: ["react", "react-dom"],
		},
		optimizeDeps: {
			entries: [],
			include: [
				"react",
				"react-dom",
				"react-dom/client",
				"react/jsx-runtime",
				"react/jsx-dev-runtime",
				"@mdx-js/react",
				"mermaid",
				"svg-pan-zoom",
				"zod",
				"framer-motion",
				"@tippyjs/react",
				"tippy.js",
				"diff",
				"lucide-react",
				"date-fns",
				"jotai",
				"jotai/utils",
				...tiptapPackages,
				"@tanstack/react-query",
				"@trpc/client",
				"@trpc/tanstack-react-query",
				"@trpc/server",
			],
		},
		// The rest of this `ssr` block exists only for src/rendering/render.ts's
		// ssrLoadModule (client/ssr-entry.tsx and, transitively, everything
		// mdx-components.ts pulls in), used to catch render-time errors during
		// `validate_doc`. Nothing else in this dev server uses the SSR
		// environment.
		//
		// Several of the packages aliased above have no ESM build — their real
		// entry files (react's index.js/client.js/jsx-runtime.js/jsx-dev-runtime.js,
		// react-dom's server.node.js, zod's index.cjs, ...) are plain CommonJS
		// (`module.exports = require(...)`). The *client* bundle only works with
		// these because the client dep optimizer (`optimizeDeps.include` above)
		// pre-bundles them into interop-safe ESM before the browser ever sees
		// them. SSR has its own, separate dep optimizer, off by default in dev,
		// so without mirroring that include list here, ssrLoadModule hits our
		// `resolve.alias` entries directly, Vite's SSR module runner transforms
		// those raw CJS files as if they were ESM (no `require`/`module`/`exports`
		// shim), and it throws ("require is not defined", "exports is not
		// defined", ...). Since `client/mdx-components.ts` pulls in every builtin
		// unconditionally (`client/builtins/index.ts`), rendering *any* doc reaches
		// this whole dependency set, not just what that one doc happens to use —
		// so everything aliased above that has a CJS-only entry needs to be
		// listed here too, run through the SAME optimizer as react/react-dom so
		// they all end up sharing one pre-bundled "react" (an externalized,
		// natively-`require`d react-dom/server would otherwise load a *second*,
		// un-optimized copy of "react" via Node's own resolution, breaking
		// hooks/context with "Cannot read properties of null").
		ssr: {
			optimizeDeps: {
				include: [
					"react",
					"react-dom",
					"react-dom/client",
					"react-dom/server",
					"react/jsx-runtime",
					"react/jsx-dev-runtime",
					"@mdx-js/react",
					"zod",
					"framer-motion",
					"@tippyjs/react",
					"tippy.js",
					"diff",
					// MdSection (client/mdx-components.ts) reads the open-section atom
					// with useAtom in its read path — not behind the Tiptap lazy
					// import — so it's reachable on every SSR render, same as the rest
					// of this list.
					"jotai",
					"jotai/utils",
					"lucide-react",
					"date-fns",
					// MdSection imports client/api.ts for the section editor's tRPC
					// client, which pulls these four in on every SSR render too.
					// @tanstack/react-query and @trpc/tanstack-react-query import
					// react, so they must share the optimizer's single copy of it.
					"@tanstack/react-query",
					"@trpc/client",
					"@trpc/tanstack-react-query",
					"@trpc/server",
				],
			},
		},
	});

	return vite;
}
