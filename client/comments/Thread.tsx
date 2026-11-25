import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import type { CommentMessage, CommentThread } from "../../src/comments/schema";
import { Icon } from "../ui/Icon";
import { CtlButton } from "./CtlButton";
import { replyDraftOf, withReplyDraft } from "./drafts";
import type { CommentsModel, ThreadView } from "./model";
import { ReplyField } from "./ReplyField";
import { pendingReplyKey, pendingSendsAtom, replyDraftsAtom, withPendingSend } from "./state";
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

function Message({
	message,
	last,
	canEdit,
	editDisabled,
	onEdit,
}: {
	message: CommentMessage;
	last: boolean;
	canEdit: boolean;
	editDisabled: boolean;
	onEdit: (body: string) => Promise<boolean>;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(message.body);
	const [pending, setPending] = useState(false);
	const agent = message.author === "agent";

	async function save() {
		setPending(true);
		const saved = await onEdit(draft);
		setPending(false);
		if (saved) setEditing(false);
	}

	return (
		<div className="group relative grid grid-cols-[24px_1fr] gap-x-2.5 not-first:mt-3.5">
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
					{canEdit && !editing ? (
						<button
							type="button"
							disabled={editDisabled}
							aria-label="Edit comment"
							onClick={() => {
								setDraft(message.body);
								setEditing(true);
							}}
							className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent p-0 text-[11.5px] font-semibold text-text-subtle opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-text-heading focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 group-hover:disabled:opacity-45 [@media(hover:none)]:opacity-100"
						>
							<Icon name="pencil" size={11} />
							Edit
						</button>
					) : null}
				</div>
				{editing ? (
					<div className="mt-1.5">
						<ReplyField
							label="Edit comment"
							sendLabel="Save comment"
							placeholder=""
							value={draft}
							onChange={setDraft}
							onSubmit={() => void save()}
							onCancel={() => setEditing(false)}
							disabled={editDisabled}
							pending={pending}
							focusNonce={0}
						/>
					</div>
				) : (
					<p className="m-0 mt-[3px] text-[13.5px] leading-[1.55] break-words whitespace-pre-wrap text-text-body">
						{message.body}
					</p>
				)}
			</div>
		</div>
	);
}

/**
 * One thread as a conversation timeline: the quote and a resolve (or reopen)
 * checkmark, the messages, and on the active thread a reply field.
 */
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
	const [drafts, setDrafts] = useAtom(replyDraftsAtom);
	const [pendingSends, setPendingSends] = useAtom(pendingSendsAtom);
	const replyKey = pendingReplyKey(model.path, thread.id);
	const replying = pendingSends.has(replyKey);
	const setReplying = (active: boolean) =>
		setPendingSends((previous) => withPendingSend(previous, replyKey, active));
	const [resolving, setResolving] = useState(false);
	const { readOnly, writesDisabled, actions } = model;
	const reply = replyDraftOf(drafts, thread.id);

	useEffect(() => {
		if (active) ref.current?.scrollIntoView({ block: "nearest" });
	}, [active]);

	async function sendReply() {
		setReplying(true);
		const submitted = reply;
		const saved = await actions.reply(thread.id, submitted);
		setReplying(false);
		// Text typed while the request ran stays.
		if (saved)
			setDrafts((previous) =>
				replyDraftOf(previous, thread.id) === submitted
					? withReplyDraft(previous, thread.id, "")
					: previous,
			);
	}

	async function toggleResolved() {
		setResolving(true);
		await actions.setResolved(thread.id, !thread.resolved);
		setResolving(false);
	}

	const state = view?.resolution.state;
	const showReply = active && !readOnly && !thread.resolved;
	const note =
		state === "section"
			? "Original text not found. Showing on the section."
			: state === "detached"
				? "Original section not found."
				: null;

	const toolbar = readOnly ? null : (
		<CtlButton
			tone="resolve"
			icon={thread.resolved ? "rotate-ccw" : "check"}
			label={thread.resolved ? "Reopen thread" : "Resolve thread"}
			disabled={writesDisabled || resolving}
			onClick={() => void toggleResolved()}
		/>
	);

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
				{toolbar}
			</div>
			{note ? <p className="m-0 text-xs text-status-warn-fg">{note}</p> : null}
			<div>
				{thread.messages.map((message, index) => (
					<Message
						key={message.id}
						message={message}
						last={index === thread.messages.length - 1}
						canEdit={!readOnly && message.author === "human"}
						editDisabled={writesDisabled}
						onEdit={async (body) => (await actions.edit(thread.id, message.id, body)) !== null}
					/>
				))}
			</div>
			{showReply ? (
				<div className="grid grid-cols-[24px_1fr] items-end gap-x-2.5">
					<Avatar author="human" />
					<ReplyField
						label="Reply"
						sendLabel="Send reply"
						placeholder={writesDisabled ? "Close the section editor to reply" : "Reply…"}
						value={reply}
						onChange={(next) => setDrafts((previous) => withReplyDraft(previous, thread.id, next))}
						onSubmit={() => void sendReply()}
						disabled={writesDisabled}
						pending={replying}
					/>
				</div>
			) : null}
		</div>
	);
}
