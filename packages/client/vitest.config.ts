import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		// Node 25+ turns on its own Web Storage and warns in every worker that has
		// no --localstorage-file; the jsdom tests use jsdom's localStorage instead.
		execArgv: ["--no-experimental-webstorage"],
	},
});
