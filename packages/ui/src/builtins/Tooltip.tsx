import { useRef, useState } from "react";
import {
	Modal,
	Pressable,
	Text,
	View,
	useWindowDimensions,
	type GestureResponderEvent,
	type HostInstance,
} from "react-native";
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
/** The height of the touched line assumed when the text cannot be measured on its own. */
const TOUCH_LINE = 20;

/**
 * What the bubble points at: the text's own box when it has one, else the line where the
 * finger is. Text nested in another `Text` is not laid out by itself, and measuring it gives
 * an empty box at the window's corner.
 *
 * @internal Exported for its tests.
 */
export function tooltipAnchor(measured: Anchor, touch: { pageX: number; pageY: number }): Anchor {
	if (measured.width > 0 && measured.height > 0) return measured;
	return { x: touch.pageX, y: touch.pageY - TOUCH_LINE / 2, width: 0, height: TOUCH_LINE };
}

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

	function show(event: GestureResponderEvent) {
		const touch = { pageX: event.nativeEvent.pageX, pageY: event.nativeEvent.pageY };
		setAnchor(null);
		setBubbleHeight(null);
		setOpen(true);
		const fromTouch = () => setAnchor(tooltipAnchor({ x: 0, y: 0, width: 0, height: 0 }, touch));
		if (!target.current) return fromTouch();
		target.current.measureInWindow((x, y, width, height) =>
			setAnchor(tooltipAnchor({ x, y, width, height }, touch)),
		);
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
