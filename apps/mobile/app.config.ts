import type { ExpoConfig } from "expo/config";

// The bundle identifier and display name are placeholders until the Apple Developer team and
// the App Store name are settled (docs/design/react-native-app.md, open question 1).
const config: ExpoConfig = {
	name: "mdxserve",
	slug: "mdxserve",
	version: "0.1.0",
	orientation: "portrait",
	scheme: "mdxserve",
	userInterfaceStyle: "automatic",
	ios: {
		bundleIdentifier: "co.alibhai.mdxserve",
		supportsTablet: true,
	},
	android: {
		package: "co.alibhai.mdxserve",
	},
	plugins: ["expo-router"],
};

export default config;
