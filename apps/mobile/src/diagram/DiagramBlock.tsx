import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Pressable as NativePressable, Text, useWindowDimensions, View } from "react-native";
import type { CodeNode } from "@mdxserve/client/document/tree-types";
import { chartDiagramKeyword, chartDiagramMessage } from "@mdxserve/shared/mermaid-chart";
import {
	NARROW_WINDOW_WIDTH,
	readFlowchartDirection,
	setFlowchartDirection,
	type FlowDirection,
} from "@mdxserve/shared/mermaid-direction";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { CodeFrame, CodeText } from "../document/CodeFrame";
import { CopyButton, DirectionButton, ViewToggle, type FrameView } from "./DiagramActions";
import { CONTROLS_HEIGHT, DiagramControls } from "./DiagramControls";
import { DiagramNotice } from "./DiagramNotice";
import { DiagramViewer } from "./DiagramViewer";
import { DiagramWebView, type DiagramRequest, type DiagramWebViewHandle } from "./DiagramWebView";
import { MAX_ZOOM, ZOOM_STEP } from "./render-call";
import { inlineDiagramSize, UNMEASURED_HEIGHT } from "./size";
import { useDiagramSizes } from "./sizes";
import {
	DIAGRAM_TIMEOUT_MS,
	diagramReducer,
	diagramRequestKey,
	initialDiagramState,
} from "./state";
import { useDiagramTheme } from "./theme";

/** The share of the window's height an inline diagram may take at most (M8). */
const MAX_HEIGHT_SHARE = 0.7;

/**
 * A fenced `mermaid` block, framed as on the web: a header with the Diagram/Code switch, the
 * flowchart layout control and Copy; the diagram drawn by mermaid.js in a WebView
 * (DiagramWebView), scaled to fit the frame, with the web's control stack (full screen, zoom
 * in, reset, zoom out) at its bottom right. A chart diagram is refused with the web client's
 * message; a source Mermaid cannot parse shows Mermaid's error; a diagram not drawn within 8
 * seconds shows its source and Try again.
 */
export function DiagramBlock({ node }: { node: CodeNode }) {
	const [view, setView] = useState<FrameView>("diagram");
	const screen = useWindowDimensions();
	const keyword = chartDiagramKeyword(node.value);

	// A layout choice is a view setting, not an edit, as on the web: it applies to the text
	// handed to Mermaid, and a new source falls back to the default.
	const authored = readFlowchartDirection(node.value);
	const preferred =
		screen.width < NARROW_WINDOW_WIDTH && (authored === "LR" || authored === "RL")
			? "TB"
			: authored;
	const [chosen, setChosen] = useState<{ source: string; direction: FlowDirection } | null>(null);
	const direction = chosen !== null && chosen.source === node.value ? chosen.direction : preferred;
	const diagramSource =
		direction !== null ? setFlowchartDirection(node.value, direction) : node.value;
	const directionButton =
		authored !== null && direction !== null ? (
			<DirectionButton
				value={direction}
				authored={authored}
				onChange={(next) => setChosen({ source: node.value, direction: next })}
			/>
		) : null;

	return (
		<CodeFrame
			node={node}
			label={node.title ?? "mermaid"}
			actions={
				<View className="flex-row items-center gap-3 pr-2.5 pl-3">
					<ViewToggle view={view} onChange={setView} />
					{view === "diagram" && keyword === null && directionButton ? (
						<View className="border-l border-code-border pl-3">{directionButton}</View>
					) : null}
					<View className="border-l border-code-border pl-3">
						<CopyButton text={node.value} />
					</View>
				</View>
			}
		>
			{keyword !== null ? (
				view === "code" ? (
					<CodeText value={node.value} source={node} />
				) : (
					<DiagramNotice heading={`Mermaid ${keyword} charts don't render here`}>
						{chartDiagramMessage(keyword)}
					</DiagramNotice>
				)
			) : (
				<DiagramBody
					node={node}
					view={view}
					source={diagramSource}
					directionButton={directionButton}
				/>
			)}
		</CodeFrame>
	);
}

function DiagramBody({
	node,
	view,
	source,
	directionButton,
}: {
	node: CodeNode;
	view: FrameView;
	/** The text handed to Mermaid: the block's, in the layout the reader sees. */
	source: string;
	directionButton: ReactNode;
}) {
	const screen = useWindowDimensions();
	const themeVariables = useDiagramTheme();
	const requestKey = diagramRequestKey(source, themeVariables);
	const nodeId = node.id ?? requestKey;
	const request: DiagramRequest = { key: requestKey, source, themeVariables };

	const [state, dispatch] = useReducer(diagramReducer, initialDiagramState(nodeId, requestKey));
	const [attempt, setAttempt] = useState(0);
	const [width, setWidth] = useState(0);
	const [open, setOpen] = useState(false);
	const [scale, setScale] = useState(1);
	const webviewRef = useRef<DiagramWebViewHandle>(null);
	const sizes = useDiagramSizes();

	useEffect(() => {
		dispatch({ kind: "request", nodeId, requestKey });
	}, [nodeId, requestKey]);

	useEffect(() => {
		const timer = setTimeout(() => dispatch({ kind: "timeout", requestKey }), DIAGRAM_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [requestKey, attempt]);

	// A reused row may still hold another block's state for one render; it is not this one's.
	const current = state.nodeId === nodeId ? state : initialDiagramState(nodeId, requestKey);
	const natural = current.kind === "drawn" ? current.size : sizes.get(source);
	const height = natural
		? inlineDiagramSize({
				natural,
				available: width,
				maxHeight: screen.height * MAX_HEIGHT_SHARE,
				// Room for the control stack beside the drawing.
				minHeight: CONTROLS_HEIGHT,
			}).height
		: UNMEASURED_HEIGHT;
	const title =
		(current.kind === "drawn" ? current.title : null) ?? node.title ?? "Mermaid diagram";
	const description = current.kind === "drawn" ? current.description : null;
	const drawn = current.kind === "drawn";
	// The drawing's area; kept mounted, hidden, behind a notice, the source or the Code tab.
	const bodyShown = view === "diagram" && (current.kind === "loading" || drawn);
	// Zoomed in place, a drag pans the drawing, as on the web; fitted, it scrolls the document
	// and a tap opens the full view.
	const zoomed = drawn && scale > 1;

	const webview = (
		<DiagramWebView
			key={attempt}
			ref={webviewRef}
			request={request}
			onZoom={setScale}
			onRendered={(key, drawing) => {
				sizes.set(source, drawing.size);
				dispatch({ kind: "rendered", requestKey: key, ...drawing });
			}}
			onError={(key, message) => dispatch({ kind: "error", requestKey: key, message })}
		/>
	);

	return (
		<View>
			{view === "code" ? <CodeText value={node.value} source={node} /> : null}
			{view === "diagram" && current.kind === "failed" ? (
				<DiagramNotice heading="Mermaid could not render this diagram" monospace={true}>
					{current.message}
				</DiagramNotice>
			) : null}
			{view === "diagram" && current.kind === "unavailable" ? (
				<View>
					<CodeText value={node.value} source={node} />
					<View className="flex-row items-center gap-3 border-t border-code-border pl-4">
						<Text className="flex-1 font-sans text-[length:var(--size-sm)] text-text-muted">
							The diagram could not be drawn.
						</Text>
						<Pressable
							onPress={() => {
								dispatch({ kind: "retry" });
								setAttempt((count) => count + 1);
							}}
							className="min-h-11 justify-center px-4"
						>
							<Text className="font-sans font-semibold text-[length:var(--size-sm)] text-text-accent">
								Try again
							</Text>
						</Pressable>
					</View>
				</View>
			) : null}
			<View
				testID="diagram-body"
				onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
				className={bodyShown ? "relative" : "hidden"}
				style={{ height }}
			>
				{drawn ? null : (
					<Text className="absolute inset-x-0 top-0 px-4 py-8 text-center font-sans text-[length:var(--size-sm)] text-text-subtle">
						Rendering diagram…
					</Text>
				)}
				{/* The one accessible element of the diagram (M16); `Pressable` from the UI package
				    would make it a plain button. */}
				<NativePressable
					accessibilityRole="imagebutton"
					accessibilityLabel={`Diagram: ${title}${description ? `. ${description}` : ""}`}
					accessibilityHint="Opens the full view"
					disabled={zoomed}
					onPress={() => setOpen(true)}
					className="flex-1"
				>
					<View
						testID="diagram-surface"
						pointerEvents={zoomed ? "auto" : "none"}
						className={drawn ? "flex-1" : "flex-1 opacity-0"}
					>
						{webview}
					</View>
				</NativePressable>
				{drawn ? (
					<View className="absolute right-3 bottom-3">
						<DiagramControls
							scale={scale}
							maxScale={MAX_ZOOM}
							onExpand={() => setOpen(true)}
							onZoomIn={() => webviewRef.current?.zoom({ kind: "zoom", factor: ZOOM_STEP })}
							onReset={() => webviewRef.current?.zoom({ kind: "reset" })}
							onZoomOut={() => webviewRef.current?.zoom({ kind: "zoom", factor: 1 / ZOOM_STEP })}
						/>
					</View>
				) : null}
			</View>
			{open ? (
				<DiagramViewer
					open={open}
					onClose={() => setOpen(false)}
					title={node.title ?? "Diagram"}
					request={request}
					source={node.value}
					directionButton={directionButton}
				/>
			) : null}
		</View>
	);
}
