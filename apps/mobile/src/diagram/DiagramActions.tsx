import { ActionSheetIOS, Text, View } from "react-native";
import type { FlowDirection } from "@mdxserve/shared/mermaid-direction";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";

/** Each 24 pt tall header control reaches 44 pt with this much room around it. */
const HEADER_SLOP = { top: 10, bottom: 10, left: 2, right: 2 };

/** An icon-only segment is 32 pt wide; this takes it to 44 pt both ways. */
const ICON_SLOP = { top: 10, bottom: 10, left: 6, right: 6 };

export type FrameView = "diagram" | "code";

/**
 * The frame's Diagram/Code switch, a segmented pill with the web's icons. With `labelled` (a
 * wide window: an unfolded Duo) each segment also names itself, as on the web; narrower, the
 * icons alone leave the frame's title the room.
 */
export function ViewToggle({
	view,
	onChange,
	labelled,
}: {
	view: FrameView;
	onChange: (view: FrameView) => void;
	labelled: boolean;
}) {
	return (
		<View
			role="tablist"
			className="flex-row gap-1 rounded-md border border-border-default bg-surface-sunken p-[3px]"
		>
			{(
				[
					{ value: "diagram", label: "Diagram", icon: "image" },
					{ value: "code", label: "Code", icon: "code" },
				] as const
			).map((option) => {
				const selected = view === option.value;
				return (
					<Pressable
						key={option.value}
						role="tab"
						aria-selected={selected}
						accessibilityState={{ selected }}
						accessibilityLabel={option.label}
						onPress={() => onChange(option.value)}
						hitSlop={labelled ? HEADER_SLOP : ICON_SLOP}
						className={`h-6 flex-row items-center justify-center gap-1.5 rounded-sm border ${selected ? "border-border-default bg-surface-card" : "border-transparent"} ${labelled ? "px-2.5" : "w-8"}`}
					>
						<Icon
							name={option.icon}
							size={12}
							className={selected ? "text-text-heading" : "text-text-subtle"}
						/>
						{labelled ? (
							<Text
								className={
									selected
										? "font-sans font-semibold text-[length:var(--size-xs)] text-text-heading"
										: "font-sans font-medium text-[length:var(--size-xs)] text-text-subtle"
								}
							>
								{option.label}
							</Text>
						) : null}
					</Pressable>
				);
			})}
		</View>
	);
}

export const DIRECTIONS: readonly FlowDirection[] = ["TB", "BT", "LR", "RL"];

const DIRECTION_ICON: Record<FlowDirection, string> = {
	TB: "arrow-down",
	BT: "arrow-up",
	LR: "arrow-right",
	RL: "arrow-left",
};

export const DIRECTION_LABEL: Record<FlowDirection, string> = {
	TB: "Top to bottom",
	BT: "Bottom to top",
	LR: "Left to right",
	RL: "Right to left",
};

/**
 * How a flowchart is laid out, for the reader's view only (the web's layout menu): an icon of
 * the current direction that opens the system's action sheet of the four, the author's marked.
 */
export function DirectionButton({
	value,
	authored,
	onChange,
}: {
	value: FlowDirection;
	/** The direction written in the source. */
	authored: FlowDirection;
	onChange: (direction: FlowDirection) => void;
}) {
	return (
		<Pressable
			accessibilityLabel={`Layout: ${DIRECTION_LABEL[value]}`}
			accessibilityHint="Chooses how the flowchart is laid out"
			hitSlop={HEADER_SLOP}
			onPress={() =>
				ActionSheetIOS.showActionSheetWithOptions(
					{
						title: "Layout",
						options: [
							...DIRECTIONS.map((direction) =>
								direction === authored
									? `${DIRECTION_LABEL[direction]} (as written)`
									: DIRECTION_LABEL[direction],
							),
							"Cancel",
						],
						cancelButtonIndex: DIRECTIONS.length,
					},
					(index) => {
						const chosen = DIRECTIONS[index];
						if (chosen) onChange(chosen);
					},
				)
			}
			className="h-6 w-8 items-center justify-center"
		>
			<Icon name={DIRECTION_ICON[value]} size="sm" className="text-text-subtle" />
		</Pressable>
	);
}
