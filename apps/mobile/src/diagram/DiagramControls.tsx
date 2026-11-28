import { View } from "react-native";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";

/** The height the inline stack of four needs, with its margins: four 44 pt buttons and rules. */
export const CONTROLS_HEIGHT = 4 * 44 + 5 + 24;

/** One control of the stack: a 44 pt square with its icon. */
function ControlButton({
	icon,
	label,
	onPress,
	disabled = false,
}: {
	icon: string;
	label: string;
	onPress: () => void;
	disabled?: boolean;
}) {
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			className="h-11 w-11 items-center justify-center"
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
 * A diagram's controls, as the web client stacks them at the diagram's bottom right: full
 * screen (inline only), zoom in, reset to fit, zoom out.
 */
export function DiagramControls({
	scale,
	maxScale,
	onExpand,
	onZoomIn,
	onReset,
	onZoomOut,
}: {
	scale: number;
	maxScale: number;
	onExpand?: () => void;
	onZoomIn: () => void;
	onReset: () => void;
	onZoomOut: () => void;
}) {
	return (
		<View
			testID="diagram-controls"
			className="overflow-hidden rounded-md border border-border-default bg-surface-card"
		>
			{onExpand ? <ControlButton icon="expand" label="Expand diagram" onPress={onExpand} /> : null}
			<View className={onExpand ? "border-t border-border-subtle" : ""}>
				<ControlButton
					icon="plus"
					label="Zoom in"
					onPress={onZoomIn}
					disabled={scale >= maxScale}
				/>
			</View>
			<View className="border-t border-border-subtle">
				<ControlButton icon="maximize" label="Reset view" onPress={onReset} disabled={scale <= 1} />
			</View>
			<View className="border-t border-border-subtle">
				<ControlButton icon="minus" label="Zoom out" onPress={onZoomOut} disabled={scale <= 1} />
			</View>
		</View>
	);
}
