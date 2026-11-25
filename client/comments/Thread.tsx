import { useEffect, useRef } from "react";
import type { CommentMessage, CommentThread } from "../../src/comments/schema";
import { Icon } from "../ui/Icon";
import type { CommentsModel, ThreadView } from "./model";
import { relativeTime } from "./time";

/** Where a thread is drawn: a sidebar row or the sheet's row. */
export type ThreadVariant = "sidebar" | "sheet";

const ACTIVE_QUOTE = "bg-[color-mix(in_oklab,var(--status-warn-fg)_32%,var(--status-warn-bg))]";

export function Avatar({ author }: { author: CommentMessage["author"] }) {
	const agent = author === "agent";
	return (
		<span
			aria-hidden
			className={
				"grid h-6 w-6 place-items-center rounded-full " +
				(agent ? "bg-surface-accent-soft text-text-accent" : "bg-surface-hover text-text-muted")
			}
		>
			<Icon name={agent ? "sparkles" : "user"} size={13} />
		</span>
	);
}

/** The quoted text, in the doc highlight's amber, on one line. */
export function QuoteText({ text, active }: { text: string; active: boolean }) {
	return (
		<span className="block truncate text-[12.5px] leading-[1.6] text-text-body">
			<mark className={"text-inherit " + (active ? ACTIVE_QUOTE : "bg-status-warn-bg")}>
				{text}
			</mark>
		</span>
	);
}

function Message({ message, last }: { message: CommentMessage; last: boolean }) {
	const agent = message.author === "agent";

	return (
		<div className="relative grid grid-cols-[24px_1fr] gap-x-2.5 not-first:mt-3.5">
			{last ? null : (
				<span
					aria-hidden
					className="absolute top-7 -bottom-3 left-[11.5px] w-px bg-border-default"
				/>
			)}
			<Avatar author={message.author} />
			<div className="min-w-0">
				<div className="flex items-baseline gap-[7px] pt-[3px] text-[12.5px] leading-[1.3]">
					<span className={"font-bold " + (agent ? "text-text-accent" : "text-text-heading")}>
						{agent ? "Agent" : "You"}
					</span>
					<time
						className="text-[11.5px] text-text-subtle tabular-nums"
						dateTime={message.createdAt}
						title={message.createdAt ? new Date(message.createdAt).toLocaleString() : undefined}
					>
						{relativeTime(message.createdAt)}
						{message.editedAt ? " · edited" : ""}
					</time>
				</div>
				<p className="m-0 mt-[3px] text-[13.5px] leading-[1.55] break-words whitespace-pre-wrap text-text-body">
					{message.body}
				</p>
			</div>
		</div>
	);
}

/** One thread as a conversation timeline: the quote and the messages. */
export function Thread({
	thread,
	view,
	active,
	variant,
	model,
}: {
	thread: CommentThread;
	view: ThreadView | undefined;
	active: boolean;
	variant: ThreadVariant;
	model: CommentsModel;
}) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (active) ref.current?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const state = view?.resolution.state;
	const note =
		state === "section"
			? "Original text not found. Showing on the section."
			: state === "detached"
				? "Original section not found."
				: null;

	return (
		<div
			ref={ref}
			data-thread-id={thread.id}
			data-active={active || undefined}
			onClick={(event) => {
				if (!(event.target as Element).closest("textarea, button, a")) {
					model.selectThread(thread.id);
				}
			}}
			className={
				"flex flex-col gap-3 pt-4 pr-3.5 pb-[18px] pl-4 " +
				(variant === "sidebar" && active ? "bg-surface-card" : "")
			}
		>
			<div className="flex items-center gap-2">
				<button
					type="button"
					title="Show in the doc"
					onClick={() => model.selectThread(thread.id)}
					className="m-0 min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
				>
					<QuoteText text={thread.anchor.quote} active={active} />
				</button>
			</div>
			{note ? <p className="m-0 text-xs text-status-warn-fg">{note}</p> : null}
			<div>
				{thread.messages.map((message, index) => (
					<Message key={message.id} message={message} last={index === thread.messages.length - 1} />
				))}
			</div>
		</div>
	);
}
