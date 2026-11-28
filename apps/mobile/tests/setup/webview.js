// react-native-webview has no native view under jest. This stand-in renders a View with every
// prop the app passed (testID "diagram-webview"), and records each instance's
// injectJavaScript and reload calls for the tests to read (`webviewCalls`).
const React = require("react");
const { View } = require("react-native");

/** One entry per mounted WebView, in mount order: { injected: string[], reloads: number }. */
const webviewCalls = [];

const WebView = React.forwardRef(function WebView(props, ref) {
	const calls = React.useMemo(() => {
		const entry = { injected: [], reloads: 0 };
		webviewCalls.push(entry);
		return entry;
	}, []);
	React.useImperativeHandle(ref, () => ({
		injectJavaScript: (script) => calls.injected.push(script),
		reload: () => {
			calls.reloads += 1;
		},
	}));
	return React.createElement(View, { ...props, calls });
});

module.exports = { WebView, default: WebView, webviewCalls };
