import type { ExpoConfig } from "expo/config";

// The logo's tile: the design tokens' --surface-inverse (apps/web/src/design/tokens/colors.css),
// the same colour `yarn mobile icon` fills assets/icon.png with.
const tileColor = "#1a1918";

const config: ExpoConfig = {
	name: "mdxserve",
	slug: "mdxserve",
	owner: "karimsa",
	version: "0.1.0",
	orientation: "portrait",
	scheme: "mdxserve",
	userInterfaceStyle: "automatic",
	// assets/icon.png and assets/mark.png are rendered from the project logo by `yarn mobile icon`
	// (scripts/render-icon.mjs). Expo Go keeps its own home screen icon; a development or TestFlight build shows these.
	icon: "./assets/icon.png",
	ios: {
		bundleIdentifier: "co.alibhai.mdxserve",
		appleTeamId: "2C843H3ZG6",
		supportsTablet: true,
	},
	android: {
		package: "co.alibhai.mdxserve",
		adaptiveIcon: {
			foregroundImage: "./assets/mark.png",
			backgroundColor: tileColor,
		},
	},
	plugins: [
		"expo-router",
		[
			"expo-splash-screen",
			{ image: "./assets/mark.png", imageWidth: 300, backgroundColor: tileColor },
		],
	],
	extra: {
		// The EAS project `eas init` created; EAS Build and Submit look it up by this id.
		eas: { projectId: "879076f5-0ba8-45f4-81d0-b1a39cb511f3" },
	},
};

export default config;
