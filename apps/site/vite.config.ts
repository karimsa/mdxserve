import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The site is a static single-page app. Every route is served by index.html, so
// the dev server and `vite preview` fall back to it for unknown paths (appType "spa").
export default defineConfig({
	appType: "spa",
	plugins: [react()],
	// One React for every workspace (yarn.config.cjs): never bundle a second copy.
	resolve: { dedupe: ["react", "react-dom"] },
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
