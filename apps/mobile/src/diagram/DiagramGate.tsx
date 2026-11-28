import { useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { Text } from "@mdxserve/ui/primitives/Text";
import { useDiagramPageUri } from "./diagram-page";

// TEMPORARY device gate (plan task 1): one WebView loading the generated page by file:// URI
// with the Security props, one flowchart, and what came back. Replaced by DiagramBlock.

const SOURCE =
	"flowchart LR\n  A[Phone] --> B{Gate}\n  B -->|pass| C[Diagrams]\n  B -->|fail| D[Stop]";

export function DiagramGate() {
	const pageUri = useDiagramPageUri();
	const webview = useRef<WebView<object>>(null);
	const [log, setLog] = useState<string[]>([]);
	const note = (line: string) => setLog((lines) => [...lines, line]);
	if (!pageUri) return <Text>Gate: waiting for the asset…</Text>;
	return (
		<View style={{ gap: 8 }}>
			<View style={{ height: 240, borderWidth: 1, borderColor: "#888" }}>
				<WebView<object>
					ref={webview}
					source={{ uri: pageUri }}
					originWhitelist={["*"]}
					onShouldStartLoadWithRequest={(request) => {
						const allowed = request.url === pageUri;
						if (!allowed) note(`refused navigation to ${request.url.slice(0, 60)}`);
						return allowed;
					}}
					allowingReadAccessToURL={pageUri}
					allowFileAccessFromFileURLs={false}
					allowUniversalAccessFromFileURLs={false}
					incognito={true}
					domStorageEnabled={false}
					sharedCookiesEnabled={false}
					thirdPartyCookiesEnabled={false}
					cacheEnabled={false}
					javaScriptEnabled={true}
					javaScriptCanOpenWindowsAutomatically={false}
					allowsLinkPreview={false}
					dataDetectorTypes="none"
					allowsBackForwardNavigationGestures={false}
					textInteractionEnabled={false}
					scrollEnabled={false}
					bounces={false}
					style={{ backgroundColor: "transparent" }}
					webviewDebuggingEnabled={__DEV__}
					onLoadEnd={() => note("page loaded")}
					onError={(event) => note(`load error: ${event.nativeEvent.description}`)}
					onMessage={(event) => {
						const data = event.nativeEvent.data;
						note(`message: ${data.slice(0, 120)}`);
						if (data.includes('"ready"')) {
							webview.current?.injectJavaScript(
								`window.mdxserveDiagram.render(${JSON.stringify({ token: 1, source: SOURCE, themeVariables: {} })});true;`,
							);
							// A link the page follows must go nowhere.
							setTimeout(() => {
								webview.current?.injectJavaScript(
									'window.location.href = "https://example.com/";true;',
								);
							}, 3000);
						}
					}}
				/>
			</View>
			<Text size="sm">{`Gate: ${pageUri.slice(0, 48)}…`}</Text>
			{log.map((line, index) => (
				<Text key={`${index}-${line}`} size="xs">
					{line}
				</Text>
			))}
		</View>
	);
}
