/** Component tests: jest-expo renders React Native components outside a device. */
const path = require("node:path");
const { transformIgnorePatterns } = require("jest-expo/jest-preset");

module.exports = {
	preset: "jest-expo",
	roots: ["<rootDir>/tests"],
	// jest-expo's list, plus Uniwind, which React Native loads from its TypeScript source.
	transformIgnorePatterns: [
		transformIgnorePatterns[0].replace("(?!(", "(?!(uniwind|"),
		...transformIgnorePatterns.slice(1),
	],
	// Components render with the app's real stylesheet, compiled by Uniwind as Metro would,
	// and `react-native` resolves to Uniwind's components as it does under Metro.
	setupFiles: ["<rootDir>/tests/setup/expo-network.js"],
	globalSetup: "<rootDir>/tests/stylesheet/global-setup.js",
	resolver: "<rootDir>/tests/stylesheet/resolver.js",
	moduleNameMapper: {
		// The device keeps the server list in AsyncStorage, whose native module jest has not got;
		// the package ships an in-memory stand-in.
		"^@react-native-async-storage/async-storage$":
			"@react-native-async-storage/async-storage/jest/async-storage-mock",
		"\\.css$": require("./tests/stylesheet/compile.js").stylesheetOutputPath,
		// React Native resolves lucide's ES module build, which jest cannot load; its CommonJS
		// build sits beside it.
		"^lucide-react-native/icons$": `${path.dirname(require.resolve("lucide-react-native"))}/icons/index.js`,
	},
};
