// Expo's defaults, which find the workspace root and its node_modules on their own, under
// Uniwind: it compiles src/global.css (Tailwind 4) into React Native styles and gives the
// components a `className`. Uniwind must stay the outermost wrapper.
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const { writeDiagramPage } = require("./scripts/diagram-page/build.js");

// Every Metro entry point (expo start, expo export, expo run:ios, EAS) loads this file, so the
// diagram page (assets/generated/diagram.html, gitignored) is built from the installed mermaid
// here, before Metro resolves the asset.
writeDiagramPage();

module.exports = withUniwindConfig(getDefaultConfig(__dirname), {
	cssEntryFile: "./src/global.css",
	dtsFile: "./src/uniwind-types.d.ts",
});
