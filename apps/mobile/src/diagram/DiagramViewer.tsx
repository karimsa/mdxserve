import { useRef, useState, type ReactNode } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { CodeText } from "../document/CodeFrame";
import { useSideInsets } from "../side-insets";
import { DiagramControls } from "./DiagramControls";
import { DiagramNotice } from "./DiagramNotice";
import { DiagramWebView, type DiagramRequest, type DiagramWebViewHandle } from "./DiagramWebView";
import { MAX_ZOOM, ZOOM_STEP } from "./render-call";

type ViewerState = { kind: "loading" } | { kind: "drawn" } | { kind: "failed"; message: string };

/**
 * A diagram's full view, the web's expanded diagram: the whole screen, a title bar with the
 * flowchart layout control, Source to read the diagram's text and Done, and the diagram
 * fitted to the rest. Pinch to zoom up to 10×, drag to pan, or use the control stack at the
 * bottom right (zoom in, reset, zoom out); the page redraws the drawing sharp at every zoom.
 * The bars keep clear of the system's vertical bar on a folded display and of the home
 * indicator.
 */
export function DiagramViewer({
	open,
	onClose,
	title,
	request,
	source,
	directionButton,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	request: DiagramRequest;
	/** The block's text as written, for Source. */
	source: string;
	/** The block's layout control, for a flowchart. */
	directionButton: ReactNode;
}) {
	const [showSource, setShowSource] = useState(false);
	const [state, setState] = useState<ViewerState>({ kind: "loading" });
	const [scale, setScale] = useState(1);
	const webviewRef = useRef<DiagramWebViewHandle>(null);
	const insets = useSafeAreaInsets();
	const sideInsets = useSideInsets();
	const drawn = state.kind === "drawn";
	return (
		<Modal
			visible={open}
			presentationStyle="fullScreen"
			animationType="slide"
			onRequestClose={onClose}
		>
			<View className="flex-1 bg-diagram-bg">
				<View
					className="flex-row items-center gap-1 border-b border-border-subtle bg-surface-raised"
					style={{
						paddingTop: insets.top,
						paddingLeft: sideInsets.paddingLeft,
						paddingRight: insets.right + 4,
					}}
				>
					<View className="h-12 flex-1 justify-center">
						<Text
							numberOfLines={1}
							className="font-sans font-semibold leading-normal text-[length:var(--size-sm)] text-text-heading"
						>
							{title}
						</Text>
						<Text
							numberOfLines={1}
							className="font-sans text-[length:var(--size-xs)] text-text-subtle"
						>
							Drag to pan · pinch to zoom
						</Text>
					</View>
					{directionButton && !showSource ? (
						<View className="h-11 min-w-11 items-center justify-center">{directionButton}</View>
					) : null}
					<Pressable
						onPress={() => setShowSource((shown) => !shown)}
						accessibilityState={{ selected: showSource }}
						className="h-11 min-w-11 justify-center px-3"
					>
						<Text className="font-sans font-semibold leading-normal text-[length:var(--size-md)] text-text-accent">
							{showSource ? "Diagram" : "Source"}
						</Text>
					</Pressable>
					<Pressable onPress={onClose} className="h-11 min-w-11 justify-center px-3">
						<Text className="font-sans font-semibold leading-normal text-[length:var(--size-md)] text-text-accent">
							Done
						</Text>
					</Pressable>
				</View>
				{showSource ? (
					<ScrollView className="flex-1 bg-code-bg" contentContainerStyle={sideInsets}>
						<CodeText value={source} />
					</ScrollView>
				) : null}
				<View className={showSource ? "hidden" : "flex-1"}>
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
					<View
						testID="diagram-viewer-area"
						className={drawn ? "flex-1" : "h-0 opacity-0"}
						style={{ paddingLeft: insets.left, paddingRight: insets.right }}
					>
						<DiagramWebView
							ref={webviewRef}
							request={request}
							onZoom={setScale}
							onRendered={(key) => {
								if (key === request.key) setState({ kind: "drawn" });
							}}
							onError={(key, message) => {
								if (key === request.key) setState({ kind: "failed", message });
							}}
						/>
					</View>
					{drawn ? (
						<View
							className="absolute"
							style={{ right: sideInsets.paddingRight, bottom: insets.bottom + 16 }}
						>
							<DiagramControls
								scale={scale}
								maxScale={MAX_ZOOM}
								onZoomIn={() => webviewRef.current?.zoom({ kind: "zoom", factor: ZOOM_STEP })}
								onReset={() => webviewRef.current?.zoom({ kind: "reset" })}
								onZoomOut={() => webviewRef.current?.zoom({ kind: "zoom", factor: 1 / ZOOM_STEP })}
							/>
						</View>
					) : null}
				</View>
			</View>
		</Modal>
	);
}
