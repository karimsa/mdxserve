import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { MAX_MESSAGE_BODY } from "./anchor";
import { canSend, fieldHeight, FIELD_MIN_HEIGHT } from "./drafts";

/**
 * One-line field that grows to 120px, with a round send button. Enter sends,
 * Shift+Enter adds a line, Escape cancels when `onCancel` is given. Controlled:
 * the caller keeps the text when a send fails.
 */
export function ReplyField({
	value,
	onChange,
	onSubmit,
	onCancel,
	placeholder,
	label,
	sendLabel,
	disabled,
	pending,
	focusNonce,
}: {
	value: string;
	onChange: (next: string) => void;
	onSubmit: () => void;
	onCancel?: () => void;
	placeholder: string;
	label: string;
	sendLabel: string;
	disabled: boolean;
	pending: boolean;
	/** Focuses the field (caret at the end) on mount and whenever this changes, when defined. */
	focusNonce?: number;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		const field = ref.current;
		if (focusNonce === undefined || !field) return;
		field.focus({ preventScroll: true });
		field.setSelectionRange(field.value.length, field.value.length);
	}, [focusNonce]);

	useLayoutEffect(() => {
		const field = ref.current;
		if (!field) return;
		field.style.height = `${FIELD_MIN_HEIGHT}px`;
		field.style.height = `${fieldHeight(field.scrollHeight)}px`;
	}, [value]);

	const ready = canSend(value, disabled, pending);

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			if (ready) onSubmit();
		} else if (event.key === "Escape" && onCancel) {
			event.preventDefault();
			event.stopPropagation();
			onCancel();
		}
	}

	return (
		<div className="group/field flex items-end gap-1.5 rounded-[9px] border border-border-default bg-surface-card py-[5px] pr-[5px] pl-[11px] focus-within:border-border-accent">
			<textarea
				ref={ref}
				data-bare-focus
				aria-label={label}
				value={value}
				rows={1}
				maxLength={MAX_MESSAGE_BODY}
				disabled={disabled}
				// Locked while a send is in flight: text typed then would be cleared with the sent draft.
				readOnly={pending}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				className="h-6 max-h-[120px] min-w-0 flex-1 resize-none rounded-sm border-0 bg-transparent px-0 py-0.5 font-sans text-[13.5px] leading-normal font-medium text-text-body caret-surface-accent outline-0 placeholder:text-text-subtle disabled:cursor-not-allowed disabled:opacity-60"
			/>
			<button
				type="button"
				aria-label={sendLabel}
				title={pending ? "Saving…" : sendLabel}
				disabled={!ready}
				onClick={onSubmit}
				className={
					"grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full border-0 p-0 transition-[color,background-color,scale] duration-150 ease-out enabled:active:scale-90 disabled:cursor-not-allowed motion-reduce:enabled:active:scale-100 " +
					(ready
						? "bg-surface-accent text-text-inverse"
						: "bg-surface-hover text-text-subtle group-focus-within/field:bg-surface-accent group-focus-within/field:text-text-inverse")
				}
			>
				<Icon name="arrow-up" size={13} />
			</button>
		</div>
	);
}
