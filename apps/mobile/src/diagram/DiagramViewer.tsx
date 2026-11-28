import { useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import { CodeText } from "../document/CodeFrame";
import { DiagramNotice } from "./DiagramNotice";
import { DiagramWebView, type DiagramRequest } from "./DiagramWebView";

type ViewerState = { kind: "loading" } | { kind: "drawn" } | { kind: "failed"; message: string };

/**
 * A diagram's full view, framed like the screenshot viewer: a page sheet with a title bar,
 * Source to read the diagram's text, and Done (or a swipe down) to close. The diagram fills the
 * sheet at 1×; WebKit's own pinch zoom takes it to 10× and redraws it sharp, and a drag pans.
 */
export function DiagramViewer({
	open,
	onClose,
	title,
	request,
	source,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	request: DiagramRequest;
	/** The block's text as written, for Source. */
	source: string;
}) {
	const [showSource, setShowSource] = useState(false);
	const [state, setState] = useState<ViewerState>({ kind: "loading" });
	const drawn = state.kind === "drawn";
	return (
		<Modal
			visible={open}
			presentationStyle="pageSheet"
			animationType="slide"
			onRequestClose={onClose}
		>
			<View className="flex-1 bg-diagram-bg">
				<View className="h-12 flex-row items-center border-b border-border-subtle bg-surface-raised pl-4">
					<Text
						numberOfLines={1}
						className="flex-1 font-sans font-semibold leading-normal text-[length:var(--size-sm)] text-text-heading"
					>
						{title}
					</Text>
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
					<ScrollView className="flex-1 bg-code-bg">
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
					<View className={drawn ? "flex-1" : "h-0 opacity-0"}>
						<DiagramWebView
							request={request}
							interactive={true}
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
		</Modal>
	);
}
