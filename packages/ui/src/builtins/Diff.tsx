import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { type DiffProps } from "@mdxserve/shared/builtins/diff";
import { useCopyText } from "../primitives/clipboard";
import { Icon } from "../primitives/Icon";
import { Pressable } from "../primitives/Pressable";
import { FadeRiseView, SlideFromView } from "../primitives/motion";
import { useSlideStart } from "../primitives/use-slide-start";
import { computeDiff } from "./diff-model";
import { DiffPanes, SplitView, UnifiedView } from "./diff-rows";

type DiffView = "unified" | "split";

const VIEWS: readonly DiffView[] = ["unified", "split"];

/** The header's segmented control: the unified or the split view, with a pill that slides. */
function ViewToggle({ active, onSelect }: { active: DiffView; onSelect(view: DiffView): void }) {
	const pill = useSlideStart(active);
	return (
		<View role="tablist" className="flex-row rounded-md bg-surface-sunken p-0.5">
			{VIEWS.map((option) => {
				const isActive = option === active;
				return (
					<Pressable
						key={option}
						role="tab"
						aria-selected={isActive}
						onPress={() => onSelect(option)}
						onLayout={pill.measure(option)}
						className="group relative rounded px-2 py-0.5"
					>
						{isActive ? (
							<SlideFromView
								from={pill.start}
								pointerEvents="none"
								className="absolute inset-0 rounded bg-surface-hover"
							/>
						) : null}
						<Text
							className={`relative font-sans font-normal capitalize leading-4 text-[length:var(--size-xs)] web:transition-colors ${
								isActive ? "text-text-heading" : "text-text-subtle group-hover:text-text-body"
							}`}
						>
							{option}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

/** Copies `text`, then says "Copied" for a moment. Hidden where there is no clipboard. */
function CopyButton({ text }: { text: string }) {
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

	async function copy() {
		try {
			await copyText!(text);
			setCopied(true);
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(false), 1500);
		} catch {
			// No clipboard after all (a browser without permission); nothing to say.
		}
	}

	return (
		<Pressable
			onPress={() => void copy()}
			className="group flex-row items-center gap-1.5 border-l border-code-border pl-3"
		>
			<Icon
				name={copied ? "check" : "copy"}
				size="sm"
				className="text-text-subtle web:transition-colors web:group-hover:text-text-body"
			/>
			<Text className="font-sans font-normal leading-4 text-[length:var(--size-xs)] text-text-subtle web:transition-colors web:group-hover:text-text-body">
				{copied ? "Copied" : "Copy"}
			</Text>
		</Pressable>
	);
}

/**
 * A GitHub-style diff of `before` and `after` in a code frame: a header with the title, the
 * added and removed line counts, a unified/split switch and a copy button (copies `after`),
 * over the rows. Long unchanged runs collapse into separators that expand when pressed.
 */
export default function Diff({
	before,
	after,
	language,
	title,
	view = "unified",
	context = 3,
}: DiffProps) {
	const [activeView, setActiveView] = useState<DiffView>(view);
	const [expanded, setExpanded] = useState<Set<number>>(new Set());
	const { rows, additions, deletions } = computeDiff(before, after, context);
	const label = title ?? language ?? "diff";

	function expand(index: number) {
		setExpanded((previous) => new Set(previous).add(index));
	}

	return (
		<FadeRiseView className="not-prose overflow-hidden rounded-lg border border-code-border bg-code-bg">
			<View className="h-[38px] flex-row items-center gap-3 border-b border-code-border pr-2.5 pl-4">
				<View className="min-w-0 flex-1 flex-row items-center gap-3">
					<Text
						numberOfLines={1}
						className="min-w-0 shrink font-mono font-normal leading-[1.72] text-[length:var(--size-xs)] text-text-subtle"
					>
						{label}
					</Text>
					<Text className="font-mono font-normal leading-[1.62] text-[length:var(--size-xs)]">
						<Text className="text-status-ok-fg">{`+${additions}`}</Text>{" "}
						<Text className="text-status-danger-fg">{`−${deletions}`}</Text>
					</Text>
				</View>
				<View className="flex-row items-center gap-3">
					<ViewToggle active={activeView} onSelect={setActiveView} />
					<CopyButton text={after} />
				</View>
			</View>
			<View className="web:block font-mono font-normal text-[length:var(--size-xs)] leading-5">
				<DiffPanes
					active={activeView}
					unified={<UnifiedView rows={rows} expanded={expanded} onExpand={expand} />}
					split={<SplitView rows={rows} expanded={expanded} onExpand={expand} />}
				/>
			</View>
		</FadeRiseView>
	);
}
