import type { KnipConfig } from "knip";

// Follow CSS `@import`s, so packages only a stylesheet loads (the fonts, tailwind and tippy's
// base css) count as used.
const cssImports = (text: string) =>
	[...text.matchAll(/@import\s+["']([^"']+)["']/g)]
		.map((match) => `import "${match[1]}";`)
		.join("\n");

const config: KnipConfig = {
	// Entries marked `!` are production code. `yarn deadcode` also runs `knip --production`,
	// which leaves the tests out, so a file or export that only a test uses is reported. A
	// deliberate test seam says so with a `/** @internal Exported for its tests. */` tag, which
	// the production run accepts. Each workspace reports its own unused files, exports and
	// dependencies.
	workspaces: {
		".": {
			entry: [
				// The dev and release scripts package.json runs, and the GitHub Actions gates
				// with their node:test suites.
				"scripts/{changelog,dev}.ts",
				".github/scripts/*.cjs",
				"tests/automation/*.test.{ts,cjs}",
			],
			project: ["scripts/**/*.ts", ".github/scripts/*.cjs", "tests/**/*.{ts,cjs}"],
		},
		"packages/server": {
			entry: [
				// The CLI and the diagram worker that esbuild bundles (scripts/build.ts).
				"src/index.ts!",
				"src/diagrams/adapters/validate-worker.ts!",
				"scripts/build.ts",
			],
			project: ["src/**/*.ts!", "scripts/**/*.ts", "tests/**/*.ts"],
		},
		"packages/shared": {
			// Each subpath in its package.json `exports` is an entry. Report the entries' exports too,
			// so one that neither the server nor the web client imports is still found.
			includeEntryExports: true,
			project: ["**/*.ts!"],
		},
		"packages/client": {
			// Each subpath in its package.json `exports` is an entry. Report the entries' exports too,
			// so one that neither the web client nor the app imports is still found.
			includeEntryExports: true,
			project: ["**/*.ts!"],
		},
		"packages/ui": {
			entry: [
				// Each subpath in its package.json `exports` is an entry; a bundler picks a component's
				// `Name.web.tsx` over its `Name.tsx` by extension, which knip does not follow.
				"src/builtins/*.tsx!",
				"src/**/*.web.{ts,tsx}!",
				// Both clients' stylesheets import it by path (apps/web/src/app.css,
				// apps/mobile/src/global.css).
				"src/theme.css!",
			],
			project: ["src/**/*.{ts,tsx,css}!"],
		},
		"apps/web": {
			entry: [
				// The browser client Vite builds from src/index.html, which loads src/entry.tsx.
				"src/index.html!",
				// index.html links this stylesheet by its served path, which knip does not resolve.
				"src/index.css!",
				// Writes the server package's dist/registry.json from the builtins, which it ships.
				"scripts/build-registry.ts!",
			],
			project: [
				"src/**/*.{ts,tsx,css}!",
				"scripts/build-registry.ts!",
				"scripts/**/*.ts",
				"tests/**/*.ts",
			],
			ignoreDependencies: [
				// Uniwind's Vite plugin points `react-native` at react-native-web (vite.config.ts); no
				// file imports it by name.
				"react-native-web",
				// Transitive @tiptap extensions pinned on purpose so their peers match our core and
				// pm (see yarn.config.cjs); nothing imports them directly.
				/^@tiptap\/extension-/,
				"@tiptap/extensions",
			],
		},
		"apps/mobile": {
			// knip's Expo plugin finds the routes in app/ and reads app.config.ts and metro.config.js;
			// its Jest plugin finds the tests.
			project: ["app/**/*.tsx!", "src/**/*.ts!", "tests/**/*.tsx"],
			// jest.config.js maps stylesheets to the one tests/stylesheet/global-setup.js compiles
			// before the tests run; it does not exist until then.
			ignoreUnresolved: [/native-stylesheet\.ios\.js$/],
			ignoreDependencies: [
				// knip expects expo-updates unless app.config.ts turns updates off; the app has no
				// over-the-air updates, so it has no expo-updates yet.
				"expo-updates",
				// app.config.ts names it as a config plugin, which knip does not read as an import.
				"expo-splash-screen",
				// Native only: autolinking builds it into the development build; no file imports it.
				"expo-dev-client",
			],
		},
		"apps/site": {
			entry: ["src/main.tsx!", "deployment/*.mjs"],
			project: ["src/**/*.{ts,tsx,css}!", "deployment/*.mjs"],
		},
	},
	compilers: { css: cssImports },
};

export default config;
