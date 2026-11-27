import { useRef, useState } from "react";
import { Modal, Pressable, Text, View, useWindowDimensions, type HostInstance } from "react-native";
import { type TooltipProps } from "@mdxserve/shared/builtins/tooltip";

interface Anchor {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Gap between the text and the bubble, and the bubble's margin from the window's edges. */
const GAP = 6;
const EDGE = 12;
/** Widest a bubble gets; it wraps its text beyond this. */
const MAX_WIDTH = 260;

/**
 * Where the bubble goes for `placement`, clamped inside the window. `left` and `right` sit
 * beside the text when there is room, and fall back to above it.
 */
function bubblePosition(
	anchor: Anchor,
	placement: NonNullable<TooltipProps["placement"]>,
	window: { width: number; height: number },
) {
	const width = Math.min(MAX_WIDTH, window.width - 2 * EDGE);
	const centred = Math.min(
		Math.max(anchor.x + anchor.width / 2 - width / 2, EDGE),
		window.width - EDGE - width,
	);
	if (placement === "bottom") return { left: centred, top: anchor.y + anchor.height + GAP, width };
	if (placement === "right" && anchor.x + anchor.width + GAP + width <= window.width - EDGE)
		return { left: anchor.x + anchor.width + GAP, top: anchor.y, width };
	if (placement === "left" && anchor.x - GAP - width >= EDGE)
		return { left: anchor.x - GAP - width, top: anchor.y, width };
	return { left: centred, bottom: window.height - anchor.y + GAP, width };
}

/**
 * The app's tooltip: the text keeps its dotted underline, and pressing and holding it shows
 * `content` in a bubble beside it until the next tap anywhere. VoiceOver reads `content` as
 * the text's hint. The web's is Tooltip.web.tsx (tippy.js, on hover and focus).
 */
export default function Tooltip({ content, placement = "top", children }: TooltipProps) {
	const target = useRef<HostInstance>(null);
	const window = useWindowDimensions();
	const [open, setOpen] = useState(false);
	const [anchor, setAnchor] = useState<Anchor | null>(null);

	function show() {
		setAnchor(null);
		setOpen(true);
		target.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
	}

	return (
		<>
			<Text
				ref={target}
				onLongPress={show}
				accessibilityHint={content}
				className="underline decoration-dotted decoration-text-subtle"
			>
				{children}
			</Text>
			<Modal
				transparent={true}
				visible={open}
				animationType="fade"
				onRequestClose={() => setOpen(false)}
			>
				<Pressable
					accessibilityLabel="Close tooltip"
					onPress={() => setOpen(false)}
					className="flex-1"
				>
					{open ? (
						// Hidden until the text has been measured, so it never shows in the wrong place.
						<View
							role="tooltip"
							className="absolute items-start"
							style={
								anchor ? bubblePosition(anchor, placement, window) : { opacity: 0, left: 0, top: 0 }
							}
						>
							<Text className="rounded-md bg-surface-inverse px-1 py-0.5 font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-inverse shadow-md">
								{content}
							</Text>
						</View>
					) : null}
				</Pressable>
			</Modal>
		</>
	);
}
