import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { WebView } from "react-native-webview";
import { useDiagramPageUri } from "./diagram-page";
import { parseDiagramMessage } from "./messages";
import { allowsNavigation } from "./navigation";
import { renderCall, zoomCall, type ZoomAction } from "./render-call";
import type { DiagramSize } from "./size";

/** One drawing asked of the page; `key` names it (`diagramRequestKey`). */
export interface DiagramRequest {
	key: string;
	source: string;
	themeVariables: Record<string, string>;
}

/** What a diagram's zoom controls call. */
export interface DiagramWebViewHandle {
	zoom(action: ZoomAction): void;
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
 * is stored. The page zooms and pans the drawing itself, from the controls (`ref`) and from
 * the touches its wrapper lets through.
 */
export function DiagramWebView({
	ref,
	request,
	onRendered,
	onError,
	onZoom,
}: {
	ref?: Ref<DiagramWebViewHandle>;
	request: DiagramRequest;
	onRendered: (key: string, drawing: DiagramDrawing) => void;
	onError: (key: string, message: string) => void;
	/** The zoom the page settled on after a control, a pinch or a new drawing (1 is fitted). */
	onZoom?: (scale: number) => void;
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

	useImperativeHandle(ref, () => ({
		zoom: (action) => {
			if (ready.current) webview.current?.injectJavaScript(zoomCall(action));
		},
	}));

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
			// The page pans and zooms the drawing itself (scripts/diagram-page/zoom.js).
			scrollEnabled={false}
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
				if (message.kind === "zoom") {
					onZoom?.(message.scale);
					return;
				}
				if (message.kind === "ready") {
					// A fresh page shows its next drawing fitted.
					onZoom?.(1);
					ready.current = true;
					sentKey.current = null;
					send();
					return;
				}
				// Only the answer to the latest request counts; the key sent with it must still be
				// the one asked for.
				const key = sentKey.current;
				if (message.token !== lastToken.current || key !== current.current.key) return;
				if (message.kind === "rendered") {
					// A new drawing starts fitted.
					onZoom?.(1);
					onRendered(key, {
						size: { width: message.width, height: message.height },
						title: message.title,
						description: message.description,
					});
				} else onError(key, message.message);
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
