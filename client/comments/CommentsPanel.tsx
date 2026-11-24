import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import type { CommentThread } from "../../src/comments/schema";
import { CtlButton } from "./CtlButton";
import { DraftThread } from "./DraftThread";
import type { CommentsModel } from "./model";
import { activeThreadAtom, draftAtom } from "./state";
import { Thread } from "./Thread";

type Tab = "open" | "resolved";

function Tabs({
	tab,
	onChange,
	openCount,
	resolvedCount,
}: {
	tab: Tab;
	onChange: (next: Tab) => void;
	openCount: number;
	resolvedCount: number;
}) {
	const entries: Array<{ value: Tab; label: string; count: number }> = [
		{ value: "open", label: "Open", count: openCount },
		{ value: "resolved", label: "Resolved", count: resolvedCount },
	];
	return (
		<div role="tablist" aria-label="Comment status" className="flex gap-3.5 self-stretch">
			{entries.map((entry) => (
				<button
					key={entry.value}
					type="button"
					role="tab"
					aria-selected={tab === entry.value}
					onClick={() => onChange(entry.value)}
					className={
						"-mb-px inline-flex cursor-pointer items-center gap-[5px] border-0 border-b-2 bg-transparent p-0 text-[12.5px] leading-none font-semibold tabular-nums " +
						(tab === entry.value
							? "border-text-heading text-text-heading"
							: "border-transparent text-text-subtle hover:text-text-heading")
					}
				>
					{entry.label}
					<span className="font-medium text-text-subtle">{entry.count}</span>
				</button>
			))}
		</div>
	);
}

/** Header and thread list shared by the docked sidebar and the phone sheet. */
export function CommentsPanel({
	model,
	variant,
	onClose,
}: {
	model: CommentsModel;
	variant: "sidebar" | "sheet";
	onClose: () => void;
}) {
	const [tab, setTab] = useState<Tab>("open");
	const activeId = useAtomValue(activeThreadAtom);
	// The composer is the sheet's: on desktop a new comment opens in the popover.
	const draft = useAtomValue(draftAtom);
	const { threads, views, readOnly } = model;
	const sheet = variant === "sheet";

	const { open, detached, resolved } = useMemo(() => {
		const unresolved = threads.filter((thread) => !thread.resolved);
		const placed: Array<{ thread: CommentThread; position: number; order: number }> = [];
		const lost: CommentThread[] = [];
		unresolved.forEach((thread, order) => {
			const view = views.get(thread.id);
			if (view?.resolution.state === "detached") lost.push(thread);
			else placed.push({ thread, position: view?.position ?? Number.MAX_SAFE_INTEGER, order });
		});
		placed.sort((left, right) => left.position - right.position || left.order - right.order);
		return {
			open: placed.map((entry) => entry.thread),
			detached: lost,
			resolved: threads.filter((thread) => thread.resolved),
		};
	}, [threads, views]);

	const shown = tab === "open" ? open : resolved;
	const empty = open.length === 0 && detached.length === 0;

	function renderThread(thread: CommentThread) {
		return (
			<Thread
				key={thread.id}
				thread={thread}
				view={views.get(thread.id)}
				active={thread.id === activeId}
				variant={variant}
				model={model}
			/>
		);
	}

	return (
		<>
			<div
				className={
					"flex h-[42px] shrink-0 items-center gap-3 border-b pr-2 pl-4 " +
					(sheet ? "border-border-subtle" : "border-border-default")
				}
			>
				<Tabs
					tab={tab}
					onChange={setTab}
					openCount={open.length + detached.length}
					resolvedCount={resolved.length}
				/>
				<span className="flex-1" />
				<CtlButton
					icon="x"
					label="Close comments"
					className="max-md:h-9 max-md:w-9"
					onClick={onClose}
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin]">
				{sheet && draft ? (
					<div className="border-b border-border-default">
						<DraftThread model={model} sidebarOpen={false} reserveTools={false} padded />
					</div>
				) : null}
				<div className="divide-y divide-border-default">
					{shown.map(renderThread)}
					{tab === "open" && detached.length > 0 ? (
						<div>
							<h3 className="m-0 px-4 pt-3.5 text-[length:var(--size-2xs)] font-semibold tracking-wide text-text-subtle uppercase">
								Detached
							</h3>
							<div className="divide-y divide-border-default">{detached.map(renderThread)}</div>
						</div>
					) : null}
				</div>
				{tab === "open" && empty && !draft ? (
					<p className="m-0 px-4 py-4 text-[length:var(--size-sm)] text-text-subtle">
						{readOnly
							? "No open comments."
							: "No open comments. Select text in the doc to add one."}
					</p>
				) : null}
				{tab === "resolved" && resolved.length === 0 ? (
					<p className="m-0 px-4 py-4 text-[length:var(--size-sm)] text-text-subtle">
						No resolved comments.
					</p>
				) : null}
			</div>
		</>
	);
}
