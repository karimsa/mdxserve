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
 * Where a bubble `height` tall goes for `placement`, kept inside the window on every side.
 * `top` and `bottom` flip to the other side of the text when theirs has no room. `left` and
 * `right` sit beside the text when there is room, and fall back to above it.
 *
 * @internal Exported for its tests.
 */
export function bubblePosition(
	anchor: Anchor,
	placement: NonNullable<TooltipProps["placement"]>,
	window: { width: number; height: number },
	height: number,
) {
	const width = Math.min(MAX_WIDTH, window.width - 2 * EDGE);
	const clampTop = (top: number) => Math.min(Math.max(top, EDGE), window.height - EDGE - height);
	const centred = Math.min(
		Math.max(anchor.x + anchor.width / 2 - width / 2, EDGE),
		window.width - EDGE - width,
	);
	const above = anchor.y - GAP - height;
	const below = anchor.y + anchor.height + GAP;
	const fitsAbove = above >= EDGE;
	const fitsBelow = below + height <= window.height - EDGE;
	if (placement === "right" && anchor.x + anchor.width + GAP + width <= window.width - EDGE)
		return { left: anchor.x + anchor.width + GAP, top: clampTop(anchor.y), width };
	if (placement === "left" && anchor.x - GAP - width >= EDGE)
		return { left: anchor.x - GAP - width, top: clampTop(anchor.y), width };
	const preferBelow = placement === "bottom" ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
	return { left: centred, top: clampTop(preferBelow ? below : above), width };
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
	const [bubbleHeight, setBubbleHeight] = useState<number | null>(null);

	function show() {
		setAnchor(null);
		setBubbleHeight(null);
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
						// Hidden until the text and the bubble have been measured, so it never shows in the
						// wrong place.
						<View
							role="tooltip"
							onLayout={(event) => setBubbleHeight(event.nativeEvent.layout.height)}
							className="absolute items-start"
							style={
								anchor && bubbleHeight !== null
									? bubblePosition(anchor, placement, window, bubbleHeight)
									: {
											opacity: 0,
											left: 0,
											top: 0,
											width: Math.min(MAX_WIDTH, window.width - 2 * EDGE),
										}
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
