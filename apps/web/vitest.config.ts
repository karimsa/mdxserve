import { defineConfig } from "vitest/config";
import { uniwind } from "uniwind/vite";

export default defineConfig({
	// The browser build's view of @mdxserve/ui (vite.config.ts): `react-native` is
	// react-native-web under Uniwind, and a `Name.web.tsx` replaces its `Name.tsx`.
	plugins: [uniwind({ cssEntryFile: "./src/index.css", dtsFile: "./src/uniwind-types.d.ts" })],
	resolve: {
		// react-native-web's ES modules, as the browser build gets them. Node's resolution would
		// pick its CommonJS build for some importers, and a component would then miss the
		// contexts of the other copy (Inline.web.tsx shares `Text`'s).
		alias: [{ find: /^react-native-web$/, replacement: "react-native-web/dist/index.js" }],
		extensions: [".web.tsx", ".web.ts", ".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
	},
	test: {
		include: ["tests/**/*.test.{ts,tsx}"],
		setupFiles: ["tests/setup.ts"],
		// Node 25+ turns on its own Web Storage and warns in every worker that has
		// no --localstorage-file; the jsdom tests use jsdom's localStorage instead.
		execArgv: ["--no-experimental-webstorage"],
		// Uniwind's components import `react-native`, which only Vite's alias turns into
		// react-native-web; Node would load React Native itself.
		server: { deps: { inline: ["uniwind", "react-native-web"] } },
	},
});
