import { useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { FadeInView, SlideFromView, type SlideStart } from "../primitives/motion";
import { webProps } from "../primitives/web-props";

export interface TabsEntry {
	/** `<Tabs id>` + `>` + `<value>`: the panel's anchor. */
	id: string;
	value: string;
	label: string;
	content: ReactNode;
}

interface TabsProps {
	id: string;
	tabs: readonly TabsEntry[];
	/** The selected tab's `value`. */
	selected: string;
	onSelect(value: string): void;
}

interface TabBox {
	x: number;
	width: number;
}

/** The arrow, Home and End keys move along the tab list, wrapping at either end. */
function nextIndexFor(key: string, activeIndex: number, count: number): number | null {
	if (key === "ArrowRight") return (activeIndex + 1) % count;
	if (key === "ArrowLeft") return (activeIndex - 1 + count) % count;
	if (key === "Home") return 0;
	if (key === "End") return count - 1;
	return null;
}

/**
 * Where the underline starts when the selection moves: under the tab selected before, relative
 * to the tab selected now. Null on the first render, or before both tabs have been laid out.
 */
function useUnderlineStart(selected: string) {
	const boxes = useRef(new Map<string, TabBox>()).current;
	const [underlined, setUnderlined] = useState(selected);
	const [start, setStart] = useState<SlideStart | null>(null);
	if (underlined !== selected) {
		// Derived during render, so the first frame with the new selection already starts there.
		const from = boxes.get(underlined);
		const to = boxes.get(selected);
		setUnderlined(selected);
		setStart(
			from && to && to.width > 0 ? { dx: from.x - to.x, scale: from.width / to.width } : null,
		);
	}
	const measure = (value: string) => (event: LayoutChangeEvent) => {
		const { x, width } = event.nativeEvent.layout;
		boxes.set(value, { x, width });
	};
	return { start, measure };
}

/**
 * A tab list over panels that all stay mounted. Inactive panels are not displayed, so a
 * printout shows only the selected tab while comment anchors and links still find the text of
 * the others. The caller owns the selection.
 */
export default function Tabs({ id, tabs, selected, onSelect }: TabsProps) {
	const tabRefs = useRef(new Map<string, { focus(): void }>()).current;
	const underline = useUnderlineStart(selected);

	const activeTab = tabs.find((tab) => tab.value === selected) ?? tabs[0];
	if (!activeTab) return null;
	const activeIndex = tabs.indexOf(activeTab);

	function handleKeyDown(event: { key: string; preventDefault(): void }) {
		const nextIndex = nextIndexFor(event.key, activeIndex, tabs.length);
		if (nextIndex === null) return;
		event.preventDefault();
		const next = tabs[nextIndex];
		onSelect(next.value);
		tabRefs.get(next.value)?.focus();
	}

	return (
		<View className="web:block" {...webProps({ dataSet: { tabs: id } })}>
			<View
				role="tablist"
				className="not-prose flex-row gap-1 border-b border-border-default"
				{...webProps({ onKeyDown: handleKeyDown })}
			>
				{tabs.map((tab) => {
					const isActive = tab === activeTab;
					return (
						<Pressable
							key={tab.id}
							ref={(element) => {
								if (element) tabRefs.set(tab.value, element);
								else tabRefs.delete(tab.value);
							}}
							role="tab"
							nativeID={`${tab.id}~tab`}
							aria-selected={isActive}
							tabIndex={isActive ? 0 : -1}
							onPress={() => onSelect(tab.value)}
							onLayout={underline.measure(tab.value)}
							className="group relative h-[34px] cursor-pointer justify-center px-3"
							{...webProps({ "aria-controls": tab.id })}
						>
							<Text
								className={
									"font-sans leading-normal text-[length:var(--size-sm)] transition-colors " +
									(isActive
										? "font-semibold text-text-heading"
										: "font-medium text-text-subtle group-hover:text-text-body")
								}
							>
								{tab.label}
							</Text>
							{isActive ? (
								<SlideFromView
									from={underline.start}
									pointerEvents="none"
									className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-teal-500"
								/>
							) : null}
						</Pressable>
					);
				})}
			</View>
			{tabs.map((tab) => {
				const isActive = tab === activeTab;
				return (
					<FadeInView
						key={tab.id}
						shown={isActive}
						nativeID={tab.id}
						role="tabpanel"
						aria-labelledby={`${tab.id}~tab`}
						className={`pt-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${isActive ? "web:block" : "hidden"}`}
						{...webProps({ dataSet: { tabPanel: "", tabsId: id, tabValue: tab.value } })}
					>
						{tab.content}
					</FadeInView>
				);
			})}
		</View>
	);
}
