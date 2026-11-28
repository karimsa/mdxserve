import { router, Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CodeText } from "../document/CodeFrame";
import { WIDE_WINDOW } from "../vertical-bar";
import { DIRECTION_LABEL, DIRECTIONS } from "./DiagramActions";
import { DiagramNotice } from "./DiagramNotice";
import { useDiagramView, useDiagramViews, type DiagramView } from "./diagram-views";
import { BAR_ICONS, DIRECTION_ICONS } from "./bar-icons";
import {
	DiagramWebView,
	FITTED,
	type DiagramWebViewHandle,
	type DiagramZoom,
} from "./DiagramWebView";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from "./render-call";
import { diagramRequestKey } from "./state";
import { useDiagramTheme } from "./theme";

type ViewerState = { kind: "loading" } | { kind: "drawn" } | { kind: "failed"; message: string };

function close() {
	if (router.canGoBack()) router.back();
}

/**
 * The screen's title for VoiceOver only: a bar title would cover the top of the diagram on a
 * folded display, where the items live in the vertical bar.
 */
function SilentTitle({ children }: { children: string }) {
	return <View accessible={true} accessibilityRole="header" accessibilityLabel={children} />;
}

/**
 * A diagram's full screen view (app/diagram.tsx), presented over the tabs: the diagram in the
 * whole content area, pinch to zoom from a fifth of fitted to 10× and drag to move it past its
 * edges, and every control a native bar item drawn with the inline controls' glyphs: zoom in,
 * reset, zoom out, the flowchart's layout, Source and Done. On a folded iPhone Duo iOS moves
 * those items into its vertical bar beside the content, and the diagram starts at the top of
 * the screen; in a wide window, or on an iPhone, they sit in the top bar and the diagram starts
 * below it. In a narrow window with no vertical bar (an iPhone in portrait) the layout and
 * Source share one More menu, so the bar holds five items.
 */
export function DiagramScreen({ viewKey }: { viewKey: string }) {
	const views = useDiagramViews();
	const view = useDiagramView(viewKey);
	useEffect(() => () => views.close(viewKey), [views, viewKey]);
	if (!view) {
		return (
			<View className="flex-1 items-center justify-center bg-diagram-bg p-8">
				<Stack.Screen options={{ title: "Diagram" }} />
				<Stack.Toolbar placement="right">
					<Stack.Toolbar.Button
						icon={BAR_ICONS.done}
						iconRenderingMode="template"
						accessibilityLabel="Done"
						onPress={close}
					/>
				</Stack.Toolbar>
				<Text className="text-center font-sans text-[length:var(--size-sm)] text-text-muted">
					This diagram is no longer open.
				</Text>
			</View>
		);
	}
	return <OpenDiagram view={view} />;
}

function OpenDiagram({ view }: { view: DiagramView }) {
	const themeVariables = useDiagramTheme();
	const request = {
		key: diagramRequestKey(view.source, themeVariables),
		source: view.source,
		themeVariables,
	};
	const [state, setState] = useState<ViewerState>({ kind: "loading" });
	const [zoomState, setZoomState] = useState<DiagramZoom>(FITTED);
	const [showSource, setShowSource] = useState(false);
	const webviewRef = useRef<DiagramWebViewHandle>(null);
	const insets = useSafeAreaInsets();
	const headerHeight = useHeaderHeight();
	const screen = useWindowDimensions();
	const drawn = state.kind === "drawn";
	const narrow = screen.width < WIDE_WINDOW;
	// A folded display: the items are in the vertical bar, so nothing is drawn across the top.
	const beside = narrow && insets.right > 0;
	// A narrow window with no bar beside it has room for five items across the top.
	const compact = narrow && insets.right === 0;
	const top = beside ? insets.top : headerHeight;
	const title = view.node.title ?? "Diagram";
	const { authored, direction } = view;
	const toggleSource = () => setShowSource((shown) => !shown);
	const zoom = (factor: number | null) =>
		webviewRef.current?.zoom(factor === null ? { kind: "reset" } : { kind: "zoom", factor });

	const layoutActions =
		authored !== null && direction !== null
			? DIRECTIONS.map((option) => (
					<Stack.Toolbar.MenuAction
						key={option}
						isOn={option === direction}
						onPress={() => view.chooseDirection(option)}
					>
						{option === authored
							? `${DIRECTION_LABEL[option]} (as written)`
							: DIRECTION_LABEL[option]}
					</Stack.Toolbar.MenuAction>
				))
			: null;

	return (
		<View className="flex-1 bg-diagram-bg">
			<Stack.Screen
				options={{
					title,
					headerTitle: SilentTitle,
					headerTransparent: true,
				}}
			/>
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Button
					icon={BAR_ICONS.zoomIn}
					iconRenderingMode="template"
					accessibilityLabel="Zoom in"
					disabled={!drawn || showSource || zoomState.scale >= MAX_ZOOM}
					onPress={() => zoom(ZOOM_STEP)}
				/>
				<Stack.Toolbar.Button
					icon={BAR_ICONS.reset}
					iconRenderingMode="template"
					accessibilityLabel="Reset view"
					disabled={!drawn || showSource || zoomState.fitted}
					onPress={() => zoom(null)}
				/>
				<Stack.Toolbar.Button
					icon={BAR_ICONS.zoomOut}
					iconRenderingMode="template"
					accessibilityLabel="Zoom out"
					disabled={!drawn || showSource || zoomState.scale <= MIN_ZOOM}
					onPress={() => zoom(1 / ZOOM_STEP)}
				/>
				{/* The toolbar takes its items as direct children: no fragments. */}
				{compact ? (
					<Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="More" title="Diagram">
						{layoutActions && direction !== null ? (
							<Stack.Toolbar.Menu title="Layout" inline={true}>
								{layoutActions}
							</Stack.Toolbar.Menu>
						) : null}
						<Stack.Toolbar.MenuAction
							icon="chevron.left.forwardslash.chevron.right"
							isOn={showSource}
							onPress={toggleSource}
						>
							Source
						</Stack.Toolbar.MenuAction>
					</Stack.Toolbar.Menu>
				) : null}
				{!compact && layoutActions && direction !== null ? (
					<Stack.Toolbar.Menu
						icon={DIRECTION_ICONS[direction]}
						iconRenderingMode="template"
						accessibilityLabel={`Layout: ${DIRECTION_LABEL[direction]}`}
						title="Layout"
					>
						{layoutActions}
					</Stack.Toolbar.Menu>
				) : null}
				{compact ? null : (
					<Stack.Toolbar.Button
						icon={BAR_ICONS.source}
						iconRenderingMode="template"
						accessibilityLabel="Source"
						selected={showSource}
						onPress={toggleSource}
					/>
				)}
				<Stack.Toolbar.Button
					icon={BAR_ICONS.done}
					iconRenderingMode="template"
					accessibilityLabel="Done"
					onPress={close}
				/>
			</Stack.Toolbar>
			{showSource ? (
				<ScrollView
					className="flex-1 bg-code-bg"
					contentContainerStyle={{
						paddingTop: top,
						paddingLeft: insets.left,
						paddingRight: insets.right,
						paddingBottom: insets.bottom,
					}}
				>
					<CodeText value={view.node.value} source={view.node} />
				</ScrollView>
			) : null}
			{/* The drawing keeps clear of the top bar where there is one, the vertical bar and the
			    home indicator. */}
			<View
				testID="diagram-screen-body"
				className={showSource ? "hidden" : "flex-1"}
				style={{
					paddingTop: top,
					paddingLeft: insets.left,
					paddingRight: insets.right,
					paddingBottom: insets.bottom,
				}}
			>
				{state.kind === "failed" ? (
					<DiagramNotice heading="Mermaid could not render this diagram" monospace={true}>
						{state.message}
					</DiagramNotice>
				) : null}
				{state.kind === "loading" ? (
					<Text className="px-4 py-8 text-center font-sans text-[length:var(--size-sm)] text-text-subtle">
						Rendering diagram…
					</Text>
				) : null}
				<View testID="diagram-screen-area" className={drawn ? "flex-1" : "h-0 opacity-0"}>
					<DiagramWebView
						ref={webviewRef}
						request={request}
						onZoom={setZoomState}
						onRendered={(key) => {
							if (key === request.key) setState({ kind: "drawn" });
						}}
						onError={(key, message) => {
							if (key === request.key) setState({ kind: "failed", message });
						}}
					/>
				</View>
			</View>
		</View>
	);
}
