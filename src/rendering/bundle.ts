import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build, type Plugin } from "vite";
import { renderAppCss } from "./app-css.js";
import { collectIconNames, loadLucideNames } from "./mdx/icon-names.js";
import { rehypeInlineImages } from "./mdx/inline-images.js";
import { resolveFromPkg, sharedViteConfig } from "./vite.js";
import { getPackageRoot } from "../infra/pkg.js";
import type { BundleInput, BundleOutput, MermaidMode } from "./protocol.js";

// vite does not re-export Rolldown's own output type, so pull the branch of
// build()'s return type that actually has an `.output` (the `write: false`,
// single-input shape this file always requests) instead of importing
// `rolldown` directly.
type BundleBuildResult = Extract<Awaited<ReturnType<typeof build>>, { output: unknown }>;

const STANDALONE_ENTRY_ID = "virtual:mdxserve-standalone";
const STANDALONE_ENTRY_RESOLVED_ID = `\0${STANDALONE_ENTRY_ID}`;

/**
 * Emits the doc's whole module graph: the generated Tailwind CSS, the
 * standalone shell (`client/standalone-entry.tsx`, owned by the client half
 * of this feature — this file only references its path), and the doc itself.
 */
function standaloneEntryPlugin(options: {
	cssFile: string;
	docPath: string;
	pkgRoot: string;
}): Plugin {
	const { cssFile, docPath, pkgRoot } = options;
	return {
		name: "mdxserve:standalone-entry",
		enforce: "pre",
		resolveId(id) {
			return id === STANDALONE_ENTRY_ID ? STANDALONE_ENTRY_RESOLVED_ID : null;
		},
		load(id) {
			if (id !== STANDALONE_ENTRY_RESOLVED_ID) return null;
			return [
				`import ${JSON.stringify(cssFile)};`,
				`import { mount, readMeta } from ${JSON.stringify(path.join(pkgRoot, "client", "standalone-entry.tsx"))};`,
				`import Doc from ${JSON.stringify(docPath)};`,
				`mount(Doc, readMeta());`,
			].join("\n");
		},
	};
}

/** A module whose default export throws `message` on every access, call, or `new`. */
function throwingStubModule(message: string): string {
	const encoded = JSON.stringify(message);
	return `function fail() { throw new Error(${encoded}); }
export default new Proxy(fail, {
	get() { throw new Error(${encoded}); },
	apply() { throw new Error(${encoded}); },
	construct() { throw new Error(${encoded}); },
});
`;
}

/** The ~200-byte facade client/Mermaid.tsx talks to: `initialize`/`render`, backed by the pinned mermaid ESM build fetched from unpkg on first use. */
function cdnMermaidFacade(): string {
	const { version } = JSON.parse(
		fs.readFileSync(resolveFromPkg("mermaid/package.json"), "utf8"),
	) as {
		version: string;
	};
	const url = `https://unpkg.com/mermaid@${version}/dist/mermaid.esm.min.mjs`;
	return `const cdnUrl = ${JSON.stringify(url)};
let loaded;
const load = () => (loaded ??= import(/* @vite-ignore */ cdnUrl).then((module) => module.default));
let config;
export default {
	initialize(next) { config = next; },
	async render(id, text) {
		const mermaid = await load();
		if (config) mermaid.initialize(config);
		return mermaid.render(id, text);
	},
};
`;
}

const NONE_MERMAID_STUB = `export default {
	initialize() {},
	async render() { throw new Error("mdxserve: this file was built without mermaid"); },
};
`;

function isElkId(id: string): boolean {
	return id === "elkjs" || id === "elkjs/lib/elk.bundled.js" || id.includes("/elkjs/");
}

function isCytoscapeId(id: string): boolean {
	return id === "cytoscape" || id.includes("/cytoscape/");
}

function isCytoscapeCoseBilkentId(id: string): boolean {
	return id === "cytoscape-cose-bilkent" || id.includes("/cytoscape-cose-bilkent/");
}

function isKatexCssId(id: string): boolean {
	return id === "katex/dist/katex.min.css" || id.endsWith("/katex/dist/katex.min.css");
}

function isKatexId(id: string): boolean {
	return id === "katex" || id.includes("/katex/");
}

/**
 * `cdn`/`none`: replace bare `mermaid` (the `mermaid` alias is omitted for
 * these modes — see the `omitAliases` comment in sharedViteConfig) with a
 * facade or a throwing stub. `bundle`: mermaid resolves for real (its alias
 * stays), but its own layout-engine dependencies are gated — elkjs always
 * throws (offline ELK layouts aren't worth the ~2.5 MB), cytoscape/katex
 * throw only when the doc has no fence that could reach them, failing open.
 */
function mermaidPlugin(mode: MermaidMode, needs: { mindmap: boolean; math: boolean }): Plugin {
	if (mode !== "bundle") {
		const stubId = "\0mdxserve:mermaid-stub";
		const source = mode === "none" ? NONE_MERMAID_STUB : cdnMermaidFacade();
		return {
			name: "mdxserve:mermaid-stub",
			enforce: "pre",
			resolveId(id) {
				return id === "mermaid" ? stubId : null;
			},
			load(id) {
				return id === stubId ? source : null;
			},
		};
	}

	const elkStubId = "\0mdxserve:elk-stub";
	const cytoscapeStubId = "\0mdxserve:cytoscape-stub";
	const katexStubId = "\0mdxserve:katex-stub";
	const katexCssStubId = "\0mdxserve:katex-css-stub.css";

	return {
		name: "mdxserve:mermaid-bundle-stubs",
		enforce: "pre",
		resolveId(id) {
			// Absolute, already-resolved paths are matched too (the "/elkjs/" /
			// "/cytoscape/" / "/katex/" substring checks), in case some other
			// resolution step hands this hook a resolved path rather than the
			// bare specifier.
			if (isElkId(id)) return elkStubId;
			if (!needs.mindmap && (isCytoscapeId(id) || isCytoscapeCoseBilkentId(id)))
				return cytoscapeStubId;
			if (!needs.math && isKatexCssId(id)) return katexCssStubId;
			if (!needs.math && isKatexId(id)) return katexStubId;
			return null;
		},
		load(id) {
			if (id === elkStubId) {
				return throwingStubModule("mdxserve: ELK layouts are not included in built files");
			}
			if (id === cytoscapeStubId) {
				return throwingStubModule("mdxserve: mindmap diagrams are not included in built files");
			}
			if (id === katexStubId) {
				return throwingStubModule("mdxserve: math ($$) is not included in built files");
			}
			if (id === katexCssStubId) return "";
			return null;
		},
	};
}

function isDynamicIconImportsId(id: string, lucideDir: string): boolean {
	// client/ui/Icon.tsx imports the concrete ".mjs" specifier (needed for
	// scripts/build-registry.ts's plain-Node ESM resolver, which has no
	// "exports" map to fall back on for this subpath) — so the bare form
	// needs matching both with and without the extension, on top of the
	// already-resolved absolute path (the "lucide-react" alias is omitted for
	// this build, so bare specifiers normally reach here unresolved, but
	// match the resolved form too in case something else resolves it first).
	if (id === "lucide-react/dynamicIconImports" || id === "lucide-react/dynamicIconImports.mjs")
		return true;
	const resolvedBase = path.join(lucideDir, "dynamicIconImports");
	return id === resolvedBase || id === `${resolvedBase}.mjs`;
}

/**
 * Resolves `lucide-react/dynamicIconImports` to a generated module holding
 * only the icon names this build actually needs, instead of lucide-react's
 * full 2,022-entry map.
 */
function lucideSubsetPlugin(iconNames: ReadonlySet<string>): Plugin {
	const lucideDir = path.dirname(resolveFromPkg("lucide-react/package.json"));
	const stubId = "\0mdxserve:lucide-subset";
	return {
		name: "mdxserve:lucide-subset",
		enforce: "pre",
		resolveId(id) {
			return isDynamicIconImportsId(id, lucideDir) ? stubId : null;
		},
		load(id) {
			if (id !== stubId) return null;
			const names = [...iconNames].sort();
			const entries = names.map((name) => {
				const iconFile = path.join(lucideDir, "dist", "esm", "icons", `${name}.mjs`);
				return `  ${JSON.stringify(name)}: () => import(${JSON.stringify(iconFile)})`;
			});
			return `export default {\n${entries.join(",\n")}\n};\n`;
		},
	};
}

/**
 * Compiles one doc into a single self-contained iife bundle plus one
 * stylesheet, via a programmatic `vite.build()`. Owns its own temp dir per
 * call; never touches `ServerLock`/`ServerRegistry`/Vite's dep-optimizer
 * cache — a Rolldown production build has no dep optimizer, and this must be
 * safe to run beside a live `mdxserve serve`.
 */
/** Local (non-node_modules, non-virtual) module ids Rolldown bundled, from the entry chunk's module map. */
function localModuleIds(result: BundleBuildResult): string[] {
	const ids: string[] = [];
	for (const item of result.output) {
		if (item.type !== "chunk" || !item.isEntry) continue;
		for (const id of Object.keys(item.modules)) {
			if (id.startsWith("\0") || !path.isAbsolute(id) || id.includes("/node_modules/")) continue;
			ids.push(id.split("?")[0]!);
		}
	}
	return ids;
}

function isUnder(file: string, dir: string): boolean {
	const relative = path.relative(dir, file);
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function bundleStandalone(input: BundleInput): Promise<BundleOutput> {
	const pkgRoot = getPackageRoot();
	const docDir = path.dirname(input.docPath);
	const warnings: string[] = [];

	const cssDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mdxserve-build-"));
	try {
		const cssFile = path.join(cssDir, "app.css");

		// Vite's alias plugin runs before every user plugin, even enforce:
		// "pre" — a substitution only wins if the matching alias is dropped.
		// lucide-react's alias would otherwise prefix-match
		// "lucide-react/dynamicIconImports" and resolve it straight through,
		// bypassing lucideSubsetPlugin.
		const omitAliases = [...(input.mermaid === "bundle" ? [] : ["mermaid"]), "lucide-react"];

		const runBuild = async (
			sourceFiles: string[],
			iconNames: ReadonlySet<string>,
		): Promise<BundleBuildResult> => {
			// Tailwind scans exactly these files (plus mdxserve's client/ and src/),
			// never the doc's directory — see the module-graph pass below.
			await fsp.writeFile(cssFile, renderAppCss({ sourceDirs: [], sourceFiles, pkgRoot }), "utf8");
			const shared = sharedViteConfig({
				// remarkSections deliberately omitted → no <MdSection> in the output.
				rehypePlugins: [
					rehypeInlineImages({ base: docDir, onWarning: (message) => warnings.push(message) }),
				],
				omitAliases,
				extraPlugins: [
					standaloneEntryPlugin({ cssFile, docPath: input.docPath, pkgRoot }),
					mermaidPlugin(input.mermaid, input.needs),
					lucideSubsetPlugin(iconNames),
				],
			});
			return (await build({
				root: cssDir,
				configFile: false,
				mode: "production",
				logLevel: "warn",
				publicDir: false,
				plugins: shared.plugins,
				resolve: shared.resolve,
				build: {
					write: false,
					// The entry CSS is imported from the JS entry (standaloneEntryPlugin),
					// never a build input, so there is nothing to split it out of.
					cssCodeSplit: false,
					modulePreload: false,
					reportCompressedSize: false,
					// Default limit is 4 KB; the self-hosted woff2 fonts are 20–60 KB.
					// The function form inlines every asset as a data URI unconditionally.
					assetsInlineLimit: () => true,
					rolldownOptions: {
						input: { standalone: STANDALONE_ENTRY_ID },
						// A plain <script> has no module-fetch semantics under file://;
						// iife implies codeSplitting: false (Rolldown's inlineDynamicImports).
						// A URL import() inside it (the CDN mermaid facade) is preserved as-is.
						output: { format: "iife", codeSplitting: false },
						// Vite's preload helper references import.meta under iife; harmless.
						onwarn(warning, warn) {
							if (warning.code !== "EMPTY_IMPORT_META") warn(warning);
						},
					},
				},
			})) as BundleBuildResult;
		};

		let result = await runBuild([input.docPath], input.iconNames);

		// Tailwind only scans the filesystem paths named in the entry CSS, never
		// Vite's module graph, and the icon subset was collected the same way.
		// Pass 1 covers the doc itself; the bundle then knows exactly which other
		// local files it pulled in (a `../shared/Fancy.tsx` the doc imports), so
		// when there are any, build once more with those files scanned for both
		// utility classes and icon names. Scanning precise files rather than the
		// doc's directory keeps `mdxserve export ~/notes.md` from walking `~`,
		// and docs that import nothing local — the common case — stay single-pass.
		const docPath = path.resolve(input.docPath);
		const imported = localModuleIds(result).filter(
			(id) => path.resolve(id) !== docPath && !isUnder(id, path.join(pkgRoot, "client")),
		);
		if (imported.length > 0) {
			const iconNames = new Set([
				...input.iconNames,
				...collectIconNames(imported, await loadLucideNames()),
			]);
			warnings.length = 0; // the rehype plugin re-runs and would repeat its warnings
			result = await runBuild([input.docPath, ...imported], iconNames);
		}

		let js: string | undefined;
		let css = "";
		for (const item of result.output) {
			if (item.type === "chunk" && item.isEntry) js = item.code;
			if (item.type === "asset" && item.fileName.endsWith(".css")) css = String(item.source);
		}
		if (js === undefined) throw new Error("mdxserve: build produced no entry chunk");

		return { js, css, warnings };
	} finally {
		await fsp.rm(cssDir, { recursive: true, force: true });
	}
}
