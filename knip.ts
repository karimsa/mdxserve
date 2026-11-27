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
				// Transitive @tiptap extensions pinned on purpose so their peers match our core and
				// pm (see yarn.config.cjs); nothing imports them directly.
				/^@tiptap\/extension-/,
				"@tiptap/extensions",
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
