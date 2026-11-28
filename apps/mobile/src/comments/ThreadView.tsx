import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, View, type HostInstance } from "react-native";
import type { Resolution } from "@mdxserve/client/comments/anchor";
import { replyDraftOf } from "@mdxserve/client/comments/drafts";
import { relativeTime } from "@mdxserve/client/comments/time";
import type { CommentMessage, CommentThread } from "@mdxserve/client/comments/threads";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Text } from "@mdxserve/ui/primitives/Text";
import { CommentField } from "./CommentField";
import type { CommentActions } from "./data";
import type { CommentsModel } from "./model";

/** What a thread needs to write: absent on a restricted server, which offers no write control (KA14). */
interface Writer {
	model: CommentsModel;
	actions: CommentActions;
}

/** Enough room around a small control for a 44 pt touch target. */
const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

function Avatar({ author }: { author: CommentMessage["author"] }) {
	const agent = author === "agent";
	return (
		<View
			aria-hidden={true}
			className={`h-6 w-6 items-center justify-center rounded-full ${agent ? "bg-surface-accent-soft" : "bg-surface-hover"}`}
		>
			<Icon
				name={agent ? "sparkles" : "user"}
				size={13}
				className={agent ? "text-text-accent" : "text-text-muted"}
			/>
		</View>
	);
}

function Message({
	message,
	threadId,
	writer,
}: {
	message: CommentMessage;
	threadId: string;
	/** Set on the active thread: a person's message then offers Edit. */
	writer: Writer | null;
}) {
	const agent = message.author === "agent";
	const age = relativeTime(message.createdAt);
	const [editing, setEditing] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Message ids are unique only within their thread.
	const key = `edit:${threadId}:${message.id}`;
	// Only a person's message can be changed; the server refuses an agent's.
	const canEdit = writer !== null && !agent;

	async function save() {
		if (!writer || editing === null) return;
		const submitted = editing;
		const result = await writer.model.send(key, () =>
			writer.actions.edit(threadId, message.id, submitted),
		);
		if (!result) return;
		if (result.kind === "failed") setError(result.message);
		else {
			setError(null);
			// Text changed while the save was on its way stays open, unsaved.
			setEditing((current) => (current === submitted ? null : current));
		}
	}

	return (
		<View className="flex-row gap-2.5">
			<Avatar author={message.author} />
			<View className="min-w-0 flex-1">
				<View className="min-h-6 flex-row items-center">
					<Text size="sm" className="flex-1">
						<Text size="sm" weight="bold" tone={agent ? "accent" : "heading"}>
							{agent ? "Agent" : "You"}
						</Text>
						<Text size="sm" tone="muted">
							{`${age === "" ? "" : `  ${age}`}${message.editedAt ? " · edited" : ""}`}
						</Text>
					</Text>
					{canEdit && editing === null ? (
						<Pressable
							role="button"
							accessibilityLabel="Edit comment"
							onPress={() => {
								setError(null);
								setEditing(message.body);
							}}
							hitSlop={HIT_SLOP}
						>
							<Text size="sm" weight="semibold" tone="muted">
								Edit
							</Text>
						</Pressable>
					) : null}
				</View>
				{writer && editing !== null ? (
					<View className="mt-1.5">
						<CommentField
							label="Edit comment"
							sendLabel="Save comment"
							placeholder=""
							value={editing}
							onChange={setEditing}
							onSubmit={() => void save()}
							onCancel={() => {
								setEditing(null);
								setError(null);
							}}
							pending={writer.model.pending.has(key)}
							error={error}
							autoFocus={true}
						/>
					</View>
				) : (
					<Text className="mt-0.5 text-[length:var(--size-md)] leading-[1.45] text-text-heading">
						{message.body}
					</Text>
				)}
			</View>
		</View>
	);
}

/** The note under a thread whose text was not found where it was written (KA18). */
function resolutionNote(resolution: Resolution | undefined): string | null {
	if (resolution?.state === "section") return "Original text not found. Showing on the section.";
	if (resolution?.state === "detached") return "Original section not found.";
	return null;
}

/**
 * One thread in the comments panel: its quote in the highlight's colour, which moves the
 * document to the text, a note when the text is not where it was, and its messages. `focus`
 * moves VoiceOver to it, when the panel opened on it from the document.
 */
export function ThreadView({
	thread,
	resolution,
	active,
	focus,
	onSelect,
	writer,
	translucent = false,
}: {
	thread: CommentThread;
	resolution: Resolution | undefined;
	active: boolean;
	focus: boolean;
	onSelect(): void;
	writer: Writer | null;
	/** Over the sheet's see-through material, the active thread's surface lets it show through. */
	translucent?: boolean;
}) {
	const [replyError, setReplyError] = useState<string | null>(null);
	const [resolveError, setResolveError] = useState<string | null>(null);
	const replyKey = `reply:${thread.id}`;
	const resolveKey = `resolve:${thread.id}`;
	const ref = useRef<HostInstance>(null);
	useEffect(() => {
		if (focus && ref.current) AccessibilityInfo.sendAccessibilityEvent(ref.current, "focus");
	}, [focus]);
	const note = resolutionNote(resolution);
	const count = thread.messages.length;

	async function sendReply() {
		if (!writer) return;
		const submitted = replyDraftOf(writer.model.replyDrafts, thread.id);
		const result = await writer.model.send(replyKey, () =>
			writer.actions.reply(thread.id, submitted),
		);
		if (!result) return;
		if (result.kind === "failed") {
			setReplyError(result.message);
			return;
		}
		setReplyError(null);
		writer.model.clearReplyDraft(thread.id, submitted);
	}

	async function toggleResolved() {
		if (!writer) return;
		const result = await writer.model.send(resolveKey, () =>
			writer.actions.setResolved(thread.id, !thread.resolved),
		);
		if (result) setResolveError(result.kind === "failed" ? result.message : null);
	}
	const quote = (
		<Text size="sm" numberOfLines={1} className="text-text-heading">
			<Text size="sm" className={active ? "bg-comment-mark-active" : "bg-comment-mark"}>
				{thread.anchor.quote}
			</Text>
		</Text>
	);
	const replies = count - 1;
	const label = `Thread on: ${thread.anchor.quote}, ${count} ${count === 1 ? "message" : "messages"}`;

	// In the list a thread is its quote, its first message and how many replies it has; choosing
	// it shows every message, the resolve control, Edit and the reply field.
	if (!active) {
		const [first] = thread.messages;
		return (
			<Pressable
				ref={ref}
				role="button"
				accessibilityLabel={`Show in the document: ${thread.anchor.quote}`}
				accessibilityHint={label}
				onPress={onSelect}
				testID={`thread-${thread.id}`}
				className="gap-2 px-4 pt-3 pb-3.5"
			>
				{quote}
				{note ? (
					<Text size="xs" className="text-status-warn-fg">
						{note}
					</Text>
				) : null}
				{first ? <Message message={first} threadId={thread.id} writer={null} /> : null}
				{replies > 0 ? (
					<Text size="sm" weight="semibold" tone="accent" className="pl-[34px]">
						{replies === 1 ? "1 reply" : `${replies} replies`}
					</Text>
				) : null}
			</Pressable>
		);
	}

	return (
		<View
			ref={ref}
			accessible={false}
			accessibilityLabel={label}
			role="group"
			testID={`thread-${thread.id}`}
			className={`gap-3 px-4 pt-3.5 pb-4 ${translucent ? "bg-surface-card/50" : "bg-surface-card"}`}
		>
			<View className="flex-row items-center gap-2">
				<Pressable
					role="button"
					accessibilityLabel={`Show in the document: ${thread.anchor.quote}`}
					accessibilityState={{ selected: true }}
					onPress={onSelect}
					hitSlop={{ top: 8, bottom: 8 }}
					className="min-w-0 flex-1"
				>
					{quote}
				</Pressable>
				{writer ? (
					<Pressable
						role="button"
						accessibilityLabel={thread.resolved ? "Reopen thread" : "Resolve thread"}
						aria-disabled={writer.model.pending.has(resolveKey)}
						disabled={writer.model.pending.has(resolveKey)}
						onPress={() => void toggleResolved()}
						hitSlop={{ top: 6, bottom: 6 }}
						className="h-8 w-11 items-center justify-center rounded-full bg-surface-accent-soft"
					>
						<Icon
							name={thread.resolved ? "rotate-ccw" : "check"}
							size={16}
							className="text-text-accent"
						/>
					</Pressable>
				) : null}
			</View>
			{resolveError !== null ? (
				<View role="alert" accessible={true}>
					<Text size="xs" className="text-status-danger-fg">
						{resolveError}
					</Text>
				</View>
			) : null}
			{note ? (
				<Text size="xs" className="text-status-warn-fg">
					{note}
				</Text>
			) : null}
			{thread.messages.map((message) => (
				<Message key={message.id} message={message} threadId={thread.id} writer={writer} />
			))}
			{writer && !thread.resolved ? (
				<CommentField
					label="Reply"
					sendLabel="Send reply"
					placeholder="Reply…"
					value={replyDraftOf(writer.model.replyDrafts, thread.id)}
					onChange={(text) => writer.model.setReplyDraft(thread.id, text)}
					onSubmit={() => void sendReply()}
					pending={writer.model.pending.has(replyKey)}
					error={replyError}
				/>
			) : null}
		</View>
	);
}
