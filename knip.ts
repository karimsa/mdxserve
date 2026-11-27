import type { KnipConfig } from "knip";

const config: KnipConfig = {
	// Entries marked `!` are production code. `yarn deadcode` also runs `knip --production`,
	// which leaves the tests out, so a file or export that only a test uses is reported. A
	// deliberate test seam says so with a `/** @internal Exported for its tests. */` tag, which
	// the production run accepts.
	//
	// site/ is not listed: it is a separate Yarn project (its own package.json and yarn.lock)
	// that CI installs, typechecks and builds in its own job.
	entry: [
		// The CLI and the diagram worker that esbuild bundles (scripts/build.ts).
		"src/index.ts!",
		"src/diagrams/adapters/validate-worker.ts!",
		// The browser client Vite builds from client/index.html, which loads client/entry.tsx.
		"client/index.html!",
		// index.html links this stylesheet by its served path, which knip does not resolve.
		"client/index.css!",
		// Writes dist/registry.json from the builtins, which the package ships.
		"scripts/build-registry.ts!",
		// Tooling that never ships: the build, dev and release scripts package.json runs, and
		// the GitHub Actions gates with their node:test suites.
		"scripts/{build,changelog,dev}.ts",
		".github/scripts/*.cjs",
		"tests/automation/*.test.cjs",
	],
	project: [
		"src/**/*.ts!",
		"client/**/*.{ts,tsx,css}!",
		"shared/**/*.ts!",
		"scripts/**/*.ts",
		".github/scripts/*.cjs",
		"tests/**/*.{ts,cjs}",
	],
	// Follow CSS `@import`s, so packages only a stylesheet loads (the fonts, tailwind and
	// tippy's base css) count as used.
	compilers: {
		css: (text: string) =>
			[...text.matchAll(/@import\s+["']([^"']+)["']/g)]
				.map((match) => `import "${match[1]}";`)
				.join("\n"),
	},
	ignoreIssues: {
		// Another change is rewriting src/servers/; its unused exports (defaultRegistryPath, and
		// the test-only defaultLockPath, parseLockPid and toOutcome) are left for it to remove.
		"src/servers/{server-registry,server-lock,remote}.ts": ["exports"],
	},
	ignoreDependencies: [
		// Transitive @tiptap extensions pinned on purpose so their peers match our core and pm
		// (see yarn.config.cjs); nothing imports them directly.
		/^@tiptap\/extension-/,
		"@tiptap/extensions",
	],
};

export default config;
