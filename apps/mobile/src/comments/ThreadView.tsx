import { useEffect, useRef } from "react";
import { AccessibilityInfo, Pressable, View, type HostInstance } from "react-native";
import type { Resolution } from "@mdxserve/client/comments/anchor";
import { relativeTime } from "@mdxserve/client/comments/time";
import type { CommentMessage, CommentThread } from "@mdxserve/client/comments/threads";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Text } from "@mdxserve/ui/primitives/Text";

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

function Message({ message }: { message: CommentMessage }) {
	const agent = message.author === "agent";
	const age = relativeTime(message.createdAt);
	return (
		<View className="flex-row gap-2.5">
			<Avatar author={message.author} />
			<View className="min-w-0 flex-1">
				<Text size="sm" className="pt-[3px]">
					<Text size="sm" weight="bold" tone={agent ? "accent" : "heading"}>
						{agent ? "Agent" : "You"}
					</Text>
					<Text size="xs" tone="subtle">
						{`${age === "" ? "" : `  ${age}`}${message.editedAt ? " · edited" : ""}`}
					</Text>
				</Text>
				<Text size="sm" className="mt-[3px]">
					{message.body}
				</Text>
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
}: {
	thread: CommentThread;
	resolution: Resolution | undefined;
	active: boolean;
	focus: boolean;
	onSelect(): void;
}) {
	const ref = useRef<HostInstance>(null);
	useEffect(() => {
		if (focus && ref.current) AccessibilityInfo.sendAccessibilityEvent(ref.current, "focus");
	}, [focus]);
	const note = resolutionNote(resolution);
	const count = thread.messages.length;
	return (
		<View
			ref={ref}
			accessible={false}
			accessibilityLabel={`Thread on: ${thread.anchor.quote}, ${count} ${count === 1 ? "message" : "messages"}`}
			role="group"
			testID={`thread-${thread.id}`}
			className={`gap-3 px-4 pt-4 pb-[18px] ${active ? "bg-surface-card" : ""}`}
		>
			<Pressable
				role="button"
				accessibilityLabel={`Show in the document: ${thread.anchor.quote}`}
				accessibilityState={{ selected: active }}
				onPress={onSelect}
				hitSlop={{ top: 8, bottom: 8 }}
			>
				<Text size="sm" numberOfLines={1}>
					<Text size="sm" className={active ? "bg-comment-mark-active" : "bg-comment-mark"}>
						{thread.anchor.quote}
					</Text>
				</Text>
			</Pressable>
			{note ? (
				<Text size="xs" className="text-status-warn-fg">
					{note}
				</Text>
			) : null}
			<View className="gap-3">
				{thread.messages.map((message) => (
					<Message key={message.id} message={message} />
				))}
			</View>
		</View>
	);
}
