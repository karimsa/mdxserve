import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
	name: "mdxserve",
	slug: "mdxserve",
	owner: "karimsa",
	version: "0.1.0",
	orientation: "portrait",
	scheme: "mdxserve",
	userInterfaceStyle: "automatic",
	ios: {
		bundleIdentifier: "co.alibhai.mdxserve",
		appleTeamId: "2C843H3ZG6",
		supportsTablet: true,
	},
	android: {
		package: "co.alibhai.mdxserve",
	},
	plugins: ["expo-router"],
	extra: {
		// The EAS project `eas init` created; EAS Build and Submit look it up by this id.
		eas: { projectId: "879076f5-0ba8-45f4-81d0-b1a39cb511f3" },
	},
};

export default config;
