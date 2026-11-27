// Metro under Uniwind (uniwind/metro) points `react-native` at Uniwind's components, which give
// `className` its styles; jest resolves modules itself, so this resolver does the same. React
// Native's own modules and Uniwind's keep the real `react-native`, as they do under Metro.
// Everything else goes to React Native's jest resolver, which this one replaces.
const path = require("node:path");
const reactNativeResolver = require("@react-native/jest-preset/jest/resolver");

const uniwindRoot = path.dirname(require.resolve("uniwind/package.json"));
const reactNativeRoot = path.dirname(require.resolve("react-native/package.json"));
const isInside = (file, folder) => file === folder || file.startsWith(folder + path.sep);

/** `react-native` itself, by name or as the folder jest-expo's moduleNameMapper turns it into. */
function isReactNativeEntry(request) {
	return request === "react-native" || path.resolve(request) === reactNativeRoot;
}

module.exports = (request, options) => {
	const origin = options.basedir;
	const fromReactNative = /node_modules[\\/](react-native|@react-native)[\\/]/.test(
		origin + path.sep,
	);
	if (isReactNativeEntry(request) && !isInside(origin, uniwindRoot) && !fromReactNative) {
		return reactNativeResolver("uniwind/components", options);
	}
	return reactNativeResolver(request, options);
};
