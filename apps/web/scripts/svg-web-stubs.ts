import type { Plugin } from "vite";

/**
 * Modules react-native-svg's web build imports that the browser has no use for, each with the
 * module it gets instead:
 *
 * - its press handling `require`s the Android touch-sound module, which reads
 *   `TurboModuleRegistry` from `react-native`; react-native-web has no such export, so Rolldown
 *   refuses to bundle it. The require only runs on Android.
 * - `<Image href>` looks a numeric asset id up in `@react-native/assets-registry`, which only a
 *   React Native bundler provides. The charts draw no images.
 */
const STUBS: Record<string, string> = {
	"../fabric/NativeSvgSoundModule": "export default null;",
	"@react-native/assets-registry/registry": "export function getAssetByID() { return null; }",
};

const PREFIX = "\0svg-web-stub:";

/** Resolves each stubbed import of react-native-svg's to its stand-in module. */
const stubs = {
	name: "mdxserve:svg-web-stubs",
	resolveId(source: string, importer: string | undefined) {
		return Object.hasOwn(STUBS, source) && importer?.includes("/react-native-svg/")
			? PREFIX + source
			: null;
	},
	load(id: string) {
		return id.startsWith(PREFIX) ? STUBS[id.slice(PREFIX.length)] : null;
	},
};

/**
 * The stubs, for the build and for the dev server's dependency pre-bundling. That runs its own
 * Rolldown, with neither Vite's plugins nor `resolve.extensions`, so it is given both: the
 * stubs, and `extensions`, so it picks react-native-svg's `.web.js` modules as the build does.
 */
export function svgWebStubs(extensions: string[]): Plugin {
	return {
		...stubs,
		enforce: "pre",
		config: () => ({
			optimizeDeps: { rolldownOptions: { plugins: [stubs], resolve: { extensions } } },
		}),
	};
}
