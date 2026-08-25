import {
	Children,
	isValidElement,
	useId,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactElement,
	type ReactNode,
} from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { TRANSITIONS } from "../motion";
import { CrossFade } from "../CrossFade";

export const tabProps = z.object({
	label: z.string().describe("Tab label shown in the tab list."),
	value: z
		.string()
		.optional()
		.describe("Stable identifier for this tab; defaults to a slug of `label`."),
	children: z.custom<ReactNode>().describe("Tab panel content; any MDX/Markdown content."),
});

export type TabProps = z.infer<typeof tabProps>;

/**
 * Renders nothing on its own — `Tabs` reads each `Tab` child's props to build
 * the tab list and panels, matching on `props.label` rather than `type ===
 * Tab` (component identity changes under Fast Refresh; see client/CodeBlock.tsx).
 */
export function Tab(_props: TabProps) {
	return null;
}

export const tabsProps = z.object({
	defaultValue: z
		.string()
		.optional()
		.describe("Value of the tab selected initially; defaults to the first tab."),
	children: z.custom<ReactNode>().describe("One or more `<Tab>` elements."),
});

export type TabsProps = z.infer<typeof tabsProps>;

function slugify(label: string): string {
	return label
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}

interface TabEntry {
	value: string;
	label: string;
	content: ReactNode;
}

type TabLikeElement = ReactElement<{ label: string; value?: string; children?: ReactNode }>;

/**
 * Pull { label, value, children } out of each `Tab` child. Matches by
 * `typeof props.label === "string"` rather than `child.type === Tab` — under
 * Fast Refresh, component identity changes across re-executions, so a type
 * check would silently stop matching (see the `Figure` lesson in CodeBlock.tsx).
 */
function collectTabs(children: ReactNode): TabEntry[] {
	return Children.toArray(children)
		.filter(
			(child): child is TabLikeElement =>
				isValidElement(child) && typeof (child.props as { label?: unknown }).label === "string",
		)
		.map((child) => {
			const { label, value, children: content } = child.props;
			return { label, value: value ?? slugify(label), content };
		});
}

export default function Tabs({ defaultValue, children }: TabsProps) {
	const tabs = collectTabs(children);
	const [active, setActive] = useState<string | undefined>(defaultValue ?? tabs[0]?.value);
	const scopeId = useId();
	const listRef = useRef<HTMLDivElement>(null);

	const activeIndex = Math.max(
		0,
		tabs.findIndex((tab) => tab.value === active),
	);
	const activeTab = tabs[activeIndex];

	function focusTabAt(index: number) {
		const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		buttons?.[index]?.focus();
	}

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (tabs.length === 0) return;
		let nextIndex: number | null = null;
		if (event.key === "ArrowRight") nextIndex = (activeIndex + 1) % tabs.length;
		else if (event.key === "ArrowLeft") nextIndex = (activeIndex - 1 + tabs.length) % tabs.length;
		else if (event.key === "Home") nextIndex = 0;
		else if (event.key === "End") nextIndex = tabs.length - 1;

		if (nextIndex !== null) {
			event.preventDefault();
			setActive(tabs[nextIndex].value);
			focusTabAt(nextIndex);
		}
	}

	if (!activeTab) return null;

	return (
		<div>
			<div
				ref={listRef}
				role="tablist"
				onKeyDown={handleKeyDown}
				className="not-prose flex gap-1 border-b border-border-default"
			>
				{tabs.map((tab) => {
					const isActive = tab.value === activeTab.value;
					return (
						<button
							key={tab.value}
							type="button"
							role="tab"
							id={`${scopeId}-tab-${tab.value}`}
							aria-selected={isActive}
							aria-controls={`${scopeId}-panel-${tab.value}`}
							tabIndex={isActive ? 0 : -1}
							onClick={() => setActive(tab.value)}
							className={
								"relative h-[34px] cursor-pointer px-3 font-sans font-medium leading-normal text-[length:var(--size-sm)] transition-colors " +
								(isActive
									? "font-semibold text-text-heading"
									: "font-medium text-text-subtle hover:text-text-body")
							}
						>
							{tab.label}
							{isActive ? (
								<motion.span
									layoutId={`${scopeId}-tab-underline`}
									transition={TRANSITIONS.snap}
									className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-teal-500"
								/>
							) : null}
						</button>
					);
				})}
			</div>
			<CrossFade
				active={activeTab.value}
				panes={tabs.map((tab) => ({
					key: tab.value,
					node: (
						<div className="pt-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{tab.content}</div>
					),
					props: {
						id: `${scopeId}-panel-${tab.value}`,
						role: "tabpanel",
						"aria-labelledby": `${scopeId}-tab-${tab.value}`,
					},
				}))}
			/>
		</div>
	);
}
