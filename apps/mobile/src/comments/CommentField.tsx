import { Pressable, TextInput, View } from "react-native";
import { useResolveClassNames } from "uniwind";
import { MAX_MESSAGE_BODY } from "@mdxserve/client/comments/anchor";
import { canSend } from "@mdxserve/client/comments/drafts";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Text } from "@mdxserve/ui/primitives/Text";

/** Enough room around a control for a 44 pt touch target. */
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

/**
 * A comment's text field with its send button: multiline, at most the server's 4000 characters.
 * Controlled, so the caller keeps the text when a send fails; `error` is that failure, read out
 * by VoiceOver.
 */
export function CommentField({
	label,
	sendLabel,
	placeholder,
	value,
	onChange,
	onSubmit,
	onCancel,
	pending,
	error,
	autoFocus = false,
}: {
	label: string;
	sendLabel: string;
	placeholder: string;
	value: string;
	onChange(text: string): void;
	onSubmit(): void;
	onCancel?: () => void;
	pending: boolean;
	error: string | null;
	autoFocus?: boolean;
}) {
	const live = canSend(value, false, pending);
	const { color: placeholderColor } = useResolveClassNames("text-text-subtle");
	return (
		<View className="gap-1.5">
			{/* A capsule that grows with its text, and a round send button beside it. */}
			<View className="flex-row items-end gap-2">
				<View className="min-h-10 flex-1 justify-center rounded-[20px] border border-border-default bg-surface-hover px-3.5">
					<TextInput
						accessibilityLabel={label}
						placeholder={placeholder}
						placeholderTextColor={
							typeof placeholderColor === "string" ? placeholderColor : undefined
						}
						value={value}
						onChangeText={onChange}
						multiline={true}
						maxLength={MAX_MESSAGE_BODY}
						autoFocus={autoFocus}
						className="max-h-32 py-[9px] font-sans text-[length:var(--size-md)] text-text-heading"
					/>
				</View>
				{onCancel ? (
					<Pressable
						role="button"
						accessibilityLabel="Cancel"
						onPress={onCancel}
						hitSlop={HIT_SLOP}
						className="h-10 items-center justify-center px-1"
					>
						<Text size="sm" weight="semibold" tone="muted">
							Cancel
						</Text>
					</Pressable>
				) : null}
				<Pressable
					role="button"
					accessibilityLabel={sendLabel}
					aria-disabled={!live}
					disabled={!live}
					onPress={onSubmit}
					className={`h-10 w-10 items-center justify-center rounded-full ${live ? "bg-surface-accent" : "bg-surface-hover"}`}
				>
					<Icon
						name={pending ? "loader" : "arrow-up"}
						size={18}
						className={live ? "text-n-25" : "text-text-subtle"}
					/>
				</Pressable>
			</View>
			{error !== null ? (
				<View role="alert" accessible={true}>
					<Text size="xs" className="text-status-danger-fg">
						{error}
					</Text>
				</View>
			) : null}
		</View>
	);
}
