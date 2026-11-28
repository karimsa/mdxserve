import { View } from "react-native";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";
import type { DiagramZoom } from "./DiagramWebView";
import { MAX_ZOOM, MIN_ZOOM } from "./render-call";

/** One button's side: compact like the web's 26 px stack, a little larger for a finger. */
const BUTTON = 32;

/** The height the inline stack of four needs, with its margins: four buttons and their rules. */
export const CONTROLS_HEIGHT = 4 * BUTTON + 5 + 24;

/**
 * The touch area beyond a button: 44 pt wide, and 44 pt tall at the stack's two ends. Between
 * two buttons the area stops at the rule, so one never takes the other's press.
 */
const SLOP = (44 - BUTTON) / 2;

/** One control of the stack: its icon in a 32 pt square. */
function ControlButton({
	icon,
	label,
	onPress,
	disabled = false,
	first = false,
	last = false,
}: {
	icon: string;
	label: string;
	onPress: () => void;
	disabled?: boolean;
	first?: boolean;
	last?: boolean;
}) {
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			hitSlop={{ left: SLOP, right: SLOP, top: first ? SLOP : 0, bottom: last ? SLOP : 0 }}
			className="h-8 w-8 items-center justify-center"
		>
			<Icon
				name={icon}
				size="sm"
				className={disabled ? "text-text-subtle opacity-50" : "text-text-muted"}
			/>
		</Pressable>
	);
}

/**
 * An inline diagram's controls, as the web client stacks them at the diagram's bottom right:
 * full screen, zoom in, reset to fit, zoom out. The full screen view has the same controls as
 * native bar items (DiagramScreen).
 */
export function DiagramControls({
	zoom,
	onExpand,
	onZoomIn,
	onReset,
	onZoomOut,
}: {
	zoom: DiagramZoom;
	onExpand: () => void;
	onZoomIn: () => void;
	onReset: () => void;
	onZoomOut: () => void;
}) {
	return (
		<View
			testID="diagram-controls"
			// The stack clips its corners; its own slop lets the buttons' slop reach past them.
			hitSlop={SLOP}
			className="overflow-hidden rounded-md border border-border-default bg-surface-card"
		>
			<ControlButton icon="expand" label="Expand diagram" onPress={onExpand} first={true} />
			<View className="border-t border-border-subtle">
				<ControlButton
					icon="plus"
					label="Zoom in"
					onPress={onZoomIn}
					disabled={zoom.scale >= MAX_ZOOM}
				/>
			</View>
			<View className="border-t border-border-subtle">
				<ControlButton
					icon="maximize"
					label="Reset view"
					onPress={onReset}
					disabled={zoom.fitted}
				/>
			</View>
			<View className="border-t border-border-subtle">
				<ControlButton
					icon="minus"
					label="Zoom out"
					last={true}
					onPress={onZoomOut}
					disabled={zoom.scale <= MIN_ZOOM}
				/>
			</View>
		</View>
	);
}
