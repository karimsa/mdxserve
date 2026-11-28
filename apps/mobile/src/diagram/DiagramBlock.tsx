import { useEffect, useReducer, useState } from "react";
import { Pressable as NativePressable, Text, useWindowDimensions, View } from "react-native";
import type { CodeNode } from "@mdxserve/client/document/tree-types";
import { chartDiagramKeyword, chartDiagramMessage } from "@mdxserve/shared/mermaid-chart";
import {
	NARROW_WINDOW_WIDTH,
	readFlowchartDirection,
	setFlowchartDirection,
} from "@mdxserve/shared/mermaid-direction";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { CodeFrame, CodeText } from "../document/CodeFrame";
import { DiagramNotice } from "./DiagramNotice";
import { DiagramViewer } from "./DiagramViewer";
import { DiagramWebView, type DiagramRequest } from "./DiagramWebView";
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

type FrameView = "diagram" | "code";

/** The frame's Diagram/Code switch, as on the web. */
function ViewToggle({ view, onChange }: { view: FrameView; onChange: (view: FrameView) => void }) {
	return (
		<View role="tablist" className="flex-row">
			{(["diagram", "code"] as const).map((option) => (
				<Pressable
					key={option}
					role="tab"
					aria-selected={view === option}
					accessibilityState={{ selected: view === option }}
					onPress={() => onChange(option)}
					hitSlop={4}
					className="min-h-11 justify-center px-3"
				>
					<Text
						className={
							view === option
								? "font-sans font-semibold text-[length:var(--size-xs)] text-text-accent"
								: "font-sans text-[length:var(--size-xs)] text-text-subtle"
						}
					>
						{option === "diagram" ? "Diagram" : "Code"}
					</Text>
				</Pressable>
			))}
		</View>
	);
}

/**
 * A fenced `mermaid` block: the frame of a code block with a Diagram/Code switch, the diagram
 * drawn by mermaid.js in a WebView (DiagramWebView), scaled to fit the frame, and its full
 * view on a tap. A chart diagram is refused with the web client's message; a source Mermaid
 * cannot parse shows Mermaid's error; a diagram not drawn within 8 seconds shows its source and
 * Try again.
 */
export function DiagramBlock({ node }: { node: CodeNode }) {
	const [view, setView] = useState<FrameView>("diagram");
	const keyword = chartDiagramKeyword(node.value);
	return (
		<CodeFrame
			node={node}
			label={node.title ?? "mermaid"}
			actions={<ViewToggle view={view} onChange={setView} />}
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
				<DiagramBody node={node} view={view} />
			)}
		</CodeFrame>
	);
}

function DiagramBody({ node, view }: { node: CodeNode; view: FrameView }) {
	const screen = useWindowDimensions();
	const authored = readFlowchartDirection(node.value);
	const source =
		screen.width < NARROW_WINDOW_WIDTH && (authored === "LR" || authored === "RL")
			? setFlowchartDirection(node.value, "TB")
			: node.value;
	const themeVariables = useDiagramTheme();
	const requestKey = diagramRequestKey(source, themeVariables);
	const nodeId = node.id ?? requestKey;
	const request: DiagramRequest = { key: requestKey, source, themeVariables };

	const [state, dispatch] = useReducer(diagramReducer, initialDiagramState(nodeId, requestKey));
	const [attempt, setAttempt] = useState(0);
	const [width, setWidth] = useState(0);
	const [open, setOpen] = useState(false);
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
			}).height
		: UNMEASURED_HEIGHT;
	const title =
		(current.kind === "drawn" ? current.title : null) ?? node.title ?? "Mermaid diagram";
	const description = current.kind === "drawn" ? current.description : null;
	const drawn = current.kind === "drawn";
	// The drawing's area; kept mounted, hidden, behind a notice, the source or the Code tab.
	const bodyShown = view === "diagram" && (current.kind === "loading" || drawn);

	const webview = (
		<DiagramWebView
			key={attempt}
			request={request}
			interactive={false}
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
					onPress={() => setOpen(true)}
					className="flex-1"
				>
					<View
						testID="diagram-surface"
						pointerEvents="none"
						className={drawn ? "flex-1" : "flex-1 opacity-0"}
					>
						{webview}
					</View>
				</NativePressable>
			</View>
			{open ? (
				<DiagramViewer
					open={open}
					onClose={() => setOpen(false)}
					title={node.title ?? "Diagram"}
					request={request}
					source={node.value}
				/>
			) : null}
		</View>
	);
}
