import { useEffect, useRef, useState } from "react";
import { ActionSheetIOS, Text, View } from "react-native";
import type { FlowDirection } from "@mdxserve/shared/mermaid-direction";
import { useCopyText } from "@mdxserve/ui/primitives/clipboard";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Pressable } from "@mdxserve/ui/primitives/Pressable";

/** Each header control reaches 44 pt tall from the 38 pt header. */
const HEADER_SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

export type FrameView = "diagram" | "code";

/** The frame's Diagram/Code switch, a segmented pill as on the web. */
export function ViewToggle({
	view,
	onChange,
}: {
	view: FrameView;
	onChange: (view: FrameView) => void;
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
						hitSlop={HEADER_SLOP}
						className={
							selected
								? "h-6 flex-row items-center gap-1.5 rounded-sm border border-border-default bg-surface-card px-2.5"
								: "h-6 flex-row items-center gap-1.5 rounded-sm border border-transparent px-2.5"
						}
					>
						<Icon
							name={option.icon}
							size={12}
							className={selected ? "text-text-heading" : "text-text-subtle"}
						/>
						<Text
							className={
								selected
									? "font-sans font-semibold text-[length:var(--size-xs)] text-text-heading"
									: "font-sans font-medium text-[length:var(--size-xs)] text-text-subtle"
							}
						>
							{option.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

const DIRECTIONS: readonly FlowDirection[] = ["TB", "BT", "LR", "RL"];

const DIRECTION_ICON: Record<FlowDirection, string> = {
	TB: "arrow-down",
	BT: "arrow-up",
	LR: "arrow-right",
	RL: "arrow-left",
};

const DIRECTION_LABEL: Record<FlowDirection, string> = {
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

/** Copies the block's text, then says "Copied" for a moment. Hidden where there is no clipboard. */
export function CopyButton({ text }: { text: string }) {
	const copyText = useCopyText();
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	if (!copyText) return null;
	const copy = copyText;
	return (
		<Pressable
			accessibilityLabel={copied ? "Copied" : "Copy"}
			hitSlop={HEADER_SLOP}
			onPress={() => {
				copy(text).then(
					() => {
						setCopied(true);
						if (timer.current) clearTimeout(timer.current);
						timer.current = setTimeout(() => setCopied(false), 1500);
					},
					() => {
						// No clipboard after all; nothing to say.
					},
				);
			}}
			className="h-6 flex-row items-center gap-1.5 px-1"
		>
			<Icon
				name={copied ? "check" : "copy"}
				size={13}
				className={copied ? "text-text-accent" : "text-text-subtle"}
			/>
			<Text
				className={
					copied
						? "font-sans font-medium text-[length:var(--size-xs)] text-text-accent"
						: "font-sans font-medium text-[length:var(--size-xs)] text-text-subtle"
				}
			>
				{copied ? "Copied" : "Copy"}
			</Text>
		</Pressable>
	);
}
