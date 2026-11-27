import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { devShell } from "./scripts/dev-shell.js";

const LUCIDE_ICON = /\/lucide-react\/dist\/esm\/icons\/[^/]+\.mjs$/;

/**
 * The browser client. `yarn build` compiles `src/` into the server package's `dist/client/`,
 * which the server serves under `/__mdxserve/`; the server never runs Vite. `yarn dev` (the
 * repository root's scripts/dev.ts) runs this config's dev server in front of a backend and
 * proxies `/__mdxserve` to it.
 */
export default defineConfig(({ command }) => ({
	root: fileURLToPath(new URL("src", import.meta.url)),
	// Built asset URLs are absolute under the server's own prefix. The dev server keeps `/`,
	// so its module URLs never collide with the proxied `/__mdxserve` paths.
	base: command === "build" ? "/__mdxserve/" : "/",
	appType: "custom",
	plugins: [react(), tailwindcss(), devShell()],
	// One React for every workspace (yarn.config.cjs): never bundle a second copy.
	resolve: { dedupe: ["react", "react-dom"] },
	build: {
		outDir: fileURLToPath(new URL("../../packages/server/dist/client", import.meta.url)),
		emptyOutDir: true,
		assetsDir: "assets",
		// Mermaid, the highlighter and the editor are dynamic imports and stay lazy chunks.
		chunkSizeWarningLimit: 1536,
		rollupOptions: {
			output: {
				// The chrome imports its icons statically (apps/web/src/ui/icon-set.ts), and lucide's
				// dynamicIconImports map reaches the same files lazily, which would otherwise
				// give each of them a chunk of its own: dozens of preloads on every page.
				manualChunks: (id, { getModuleInfo }) =>
					LUCIDE_ICON.test(id) && (getModuleInfo(id)?.importers.length ?? 0) > 0
						? "chrome-icons"
						: undefined,
			},
		},
	},
	server: {
		proxy: {
			"/__mdxserve": {
				target: process.env.MDXSERVE_DEV_BACKEND ?? "http://127.0.0.1:4041",
				// The live update socket (`/__mdxserve/socket.io`) upgrades through the proxy too.
				ws: true,
			},
		},
	},
}));
