import { useContext, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { motion } from "framer-motion";
import { TRANSITIONS, fadeSwapTransition } from "../motion";
import { DocContext } from "../DocContext";
import { selectTabs, tabSelectionAtom, tabSelectionKey } from "../document/tabs-state";
import type { TabProps } from "../../shared/builtins/tabs";

/**
 * Never rendered: the document tree turns each `<Tab>` into an entry of its
 * `Tabs` node. It stays in the builtin list so `mdxserve components` and the
 * editor's templates describe it.
 */
export function Tab(_props: TabProps) {
	return null;
}

interface TabsEntry {
	/** `<Tabs id>` + `>` + `<value>`: the panel's anchor. */
	id: string;
	value: string;
	label: string;
	content: ReactNode;
}

export interface TabsViewProps {
	id: string;
	defaultValue: string;
	tabs: readonly TabsEntry[];
}

/**
 * A tab list over panels that all stay mounted. Inactive panels carry
 * `hidden`, so a printout shows only the selected tab while comment anchors
 * and links still find the text of the others. The selection lives in
 * `tabSelectionAtom` under the document path and this `Tabs`'s id, so it
 * survives the document changing on disk and `revealNode` can set it.
 */
export default function Tabs({ id, defaultValue, tabs }: TabsViewProps) {
	const documentPath = useContext(DocContext)?.path ?? "";
	const key = tabSelectionKey(documentPath, id);
	const chosen = useAtomValue(tabSelectionAtom)[key];
	const listRef = useRef<HTMLDivElement>(null);

	const activeTab =
		tabs.find((tab) => tab.value === chosen) ??
		tabs.find((tab) => tab.value === defaultValue) ??
		tabs[0];
	const activeIndex = activeTab ? tabs.indexOf(activeTab) : -1;

	function choose(value: string) {
		selectTabs(documentPath, [{ tabsId: id, value }]);
	}

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
			choose(tabs[nextIndex].value);
			focusTabAt(nextIndex);
		}
	}

	if (!activeTab) return null;

	return (
		<div data-tabs={id}>
			<div
				ref={listRef}
				role="tablist"
				onKeyDown={handleKeyDown}
				className="not-prose flex gap-1 border-b border-border-default"
			>
				{tabs.map((tab) => {
					const isActive = tab === activeTab;
					return (
						<button
							key={tab.id}
							type="button"
							role="tab"
							id={`${tab.id}~tab`}
							aria-selected={isActive}
							aria-controls={tab.id}
							tabIndex={isActive ? 0 : -1}
							onClick={() => choose(tab.value)}
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
									layoutId={`${id}~tab-underline`}
									transition={TRANSITIONS.snap}
									className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-teal-500"
								/>
							) : null}
						</button>
					);
				})}
			</div>
			{tabs.map((tab) => {
				const isActive = tab === activeTab;
				return (
					<motion.div
						key={tab.id}
						id={tab.id}
						role="tabpanel"
						aria-labelledby={`${tab.id}~tab`}
						data-tab-panel=""
						data-tabs-id={id}
						data-tab-value={tab.value}
						hidden={!isActive}
						initial={false}
						animate={{ opacity: isActive ? 1 : 0 }}
						transition={fadeSwapTransition}
						className="pt-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
					>
						{tab.content}
					</motion.div>
				);
			})}
		</div>
	);
}
