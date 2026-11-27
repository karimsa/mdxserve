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
	moduleNameMapper: {
		// Uniwind compiles the stylesheet under Metro; under jest a component's `className` has
		// no style, so the stylesheet is an empty module.
		"\\.css$": "<rootDir>/tests/empty-stylesheet.js",
		// React Native resolves lucide's ES module build, which jest cannot load; its CommonJS
		// build sits beside it.
		"^lucide-react-native/icons/(.*)$": `${path.dirname(require.resolve("lucide-react-native"))}/icons/$1.js`,
	},
};
