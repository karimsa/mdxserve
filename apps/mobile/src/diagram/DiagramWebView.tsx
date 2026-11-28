import { useEffect, useRef } from "react";
import { WebView } from "react-native-webview";
import { useDiagramPageUri } from "./diagram-page";
import { parseDiagramMessage } from "./messages";
import { allowsNavigation } from "./navigation";
import { renderCall } from "./render-call";
import type { DiagramSize } from "./size";

/** One drawing asked of the page; `key` names it (`diagramRequestKey`). */
export interface DiagramRequest {
	key: string;
	source: string;
	themeVariables: Record<string, string>;
}

export interface DiagramDrawing {
	size: DiagramSize;
	title: string | null;
	description: string | null;
}

/**
 * One WebView on the diagram page (assets/generated/diagram.html). It sends `request` to the
 * page once the page is ready and again whenever its key changes, and reports what came back
 * for the current request only. The page is a local file under a policy that allows no
 * network, and the WebView loads nothing else: every navigation away is refused, and nothing
 * is stored. Inline (`interactive` false) it takes no touches; the full view scrolls and zooms.
 */
export function DiagramWebView({
	request,
	interactive,
	onRendered,
	onError,
}: {
	request: DiagramRequest;
	interactive: boolean;
	onRendered: (key: string, drawing: DiagramDrawing) => void;
	onError: (key: string, message: string) => void;
}) {
	const pageUri = useDiagramPageUri();
	const webview = useRef<WebView<object>>(null);
	const ready = useRef(false);
	const lastToken = useRef(0);
	const sentKey = useRef<string | null>(null);
	const current = useRef(request);
	current.current = request;

	function send() {
		const latest = current.current;
		if (!ready.current || sentKey.current === latest.key) return;
		lastToken.current += 1;
		sentKey.current = latest.key;
		webview.current?.injectJavaScript(
			renderCall({
				token: lastToken.current,
				source: latest.source,
				themeVariables: latest.themeVariables,
			}),
		);
	}

	useEffect(send, [request.key]);

	if (!pageUri) return null;
	return (
		<WebView<object>
			ref={webview}
			testID="diagram-webview"
			source={{ uri: pageUri }}
			// "*" leaves allowsNavigation as the only judge: with a narrower list the WebView hands
			// a refused URL to Linking, which would open Safari.
			originWhitelist={["*"]}
			onShouldStartLoadWithRequest={(navigation) => allowsNavigation(navigation.url, pageUri)}
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
			scrollEnabled={interactive}
			bounces={false}
			showsHorizontalScrollIndicator={false}
			showsVerticalScrollIndicator={false}
			style={{ flex: 1, backgroundColor: "transparent" }}
			webviewDebuggingEnabled={__DEV__}
			accessibilityElementsHidden={true}
			importantForAccessibility="no-hide-descendants"
			onMessage={(event) => {
				const message = parseDiagramMessage(event.nativeEvent.data);
				if (!message) return;
				if (message.kind === "ready") {
					ready.current = true;
					sentKey.current = null;
					send();
					return;
				}
				// Only the answer to the latest request counts; the key sent with it must still be
				// the one asked for.
				const key = sentKey.current;
				if (message.token !== lastToken.current || key !== current.current.key) return;
				if (message.kind === "rendered")
					onRendered(key, {
						size: { width: message.width, height: message.height },
						title: message.title,
						description: message.description,
					});
				else onError(key, message.message);
			}}
			// iOS ends a WebView's process under memory pressure; the page's next "ready" sends the
			// current request again.
			onContentProcessDidTerminate={() => {
				ready.current = false;
				webview.current?.reload();
			}}
		/>
	);
}
