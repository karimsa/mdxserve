import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import { TRANSITIONS, VARIANTS } from "../motion";
import { Icon } from "./Icon";

/** An option's value and label as one string, or a value with its own label and description. */
type DropdownOption = string | { value: string; label: string; description?: string };

interface DropdownProps {
	/** Label shown above the control. */
	label?: string;
	/** Lucide icon name; renders an icon-only trigger instead, and `label` becomes its accessible name. */
	icon?: string;
	options?: DropdownOption[];
	/** Selected value (controlled); requires `onChange` to update it. */
	value?: string;
	/** Initially selected value (uncontrolled). */
	defaultValue?: string;
	/** Text shown on the trigger while nothing is selected. */
	placeholder?: string;
	/** Control height: sm (28px) or md (34px). */
	size?: "sm" | "md";
	disabled?: boolean;
	/** Called with the new value whenever the selection changes. */
	onChange?: (value: string) => void;
}

interface Entry {
	value: string;
	label: string;
	description?: string;
}

/* Trigger height and the text size shared by the trigger and the menu rows. */
const SIZE_CLASSES: Record<
	NonNullable<DropdownProps["size"]>,
	{ trigger: string; text: string }
> = {
	sm: { trigger: "h-7 pl-2 pr-1.5", text: "text-[length:var(--size-sm)]" },
	md: { trigger: "h-[34px] pl-2.5 pr-2", text: "text-[length:var(--size-md)]" },
};

/**
 * A menu-style picker: a button that opens a popover listbox, styled like the
 * rest of the chrome (card surface, hairline border, teal selection) and
 * animated with the design's `pop` entrance. Fully keyboard operable
 * (Enter/Space/arrows open, arrows/Home/End move, Enter picks, Esc closes).
 */
export default function Dropdown({
	label,
	icon,
	options,
	value,
	defaultValue,
	placeholder = "Choose one",
	size = "md",
	disabled = false,
	onChange,
}: DropdownProps) {
	const entries: Entry[] = (options ?? []).map((option) =>
		typeof option === "string" ? { value: option, label: option } : option,
	);

	const controlled = value !== undefined;
	const [internal, setInternal] = useState<string | undefined>(defaultValue);
	const current = controlled ? value : internal;
	const selected = entries.find((entry) => entry.value === current);

	const [open, setOpen] = useState(false);
	const [highlighted, setHighlighted] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const id = useId();
	const listboxId = `${id}-listbox`;

	function select(next: string) {
		if (!controlled) setInternal(next);
		onChange?.(next);
		setOpen(false);
		triggerRef.current?.focus();
	}

	function openMenu() {
		if (disabled || entries.length === 0) return;
		const idx = Math.max(
			0,
			entries.findIndex((entry) => entry.value === current),
		);
		setHighlighted(idx);
		setOpen(true);
	}

	// Close on outside click / focus leaving the component.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	// Keep the highlighted row in view while arrowing through a long list.
	useEffect(() => {
		if (!open) return;
		const row = listRef.current?.children[highlighted] as HTMLElement | undefined;
		row?.scrollIntoView({ block: "nearest" });
	}, [open, highlighted]);

	function onKeyDown(event: KeyboardEvent<HTMLElement>) {
		if (disabled) return;
		const last = entries.length - 1;
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				if (!open) openMenu();
				else setHighlighted((index) => Math.min(last, index + 1));
				break;
			case "ArrowUp":
				event.preventDefault();
				if (!open) openMenu();
				else setHighlighted((index) => Math.max(0, index - 1));
				break;
			case "Home":
				if (open) {
					event.preventDefault();
					setHighlighted(0);
				}
				break;
			case "End":
				if (open) {
					event.preventDefault();
					setHighlighted(last);
				}
				break;
			case "Enter":
			case " ":
				event.preventDefault();
				if (!open) openMenu();
				else if (entries[highlighted]) select(entries[highlighted].value);
				break;
			case "Escape":
				if (open) {
					event.preventDefault();
					setOpen(false);
					triggerRef.current?.focus();
				}
				break;
			case "Tab":
				setOpen(false);
				break;
		}
	}

	return (
		<div
			ref={rootRef}
			className={
				icon
					? "not-prose relative inline-flex"
					: "not-prose relative inline-flex w-full max-w-xs flex-col gap-1.5"
			}
			onKeyDown={onKeyDown}
		>
			{label && !icon ? (
				<span
					id={`${id}-label`}
					className="font-sans text-[length:var(--size-sm)] font-semibold leading-normal text-text-heading"
				>
					{label}
				</span>
			) : null}
			{icon ? (
				<button
					ref={triggerRef}
					type="button"
					role="combobox"
					aria-haspopup="listbox"
					aria-expanded={open}
					aria-controls={listboxId}
					disabled={disabled}
					onClick={() => (open ? setOpen(false) : openMenu())}
					aria-label={`${label ?? "Choose"}: ${selected ? selected.label : placeholder}`}
					title={`${label ?? "Choose"}: ${selected ? selected.label : placeholder}`}
					className={[
						"inline-flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent transition-colors",
						"disabled:cursor-not-allowed disabled:opacity-45",
						open ? "bg-surface-active text-text-heading" : "text-text-muted hover:bg-surface-hover",
					].join(" ")}
				>
					<Icon name={icon} size="sm" />
				</button>
			) : (
				<button
					ref={triggerRef}
					type="button"
					role="combobox"
					aria-haspopup="listbox"
					aria-expanded={open}
					aria-controls={listboxId}
					aria-labelledby={label ? `${id}-label` : undefined}
					disabled={disabled}
					onClick={() => (open ? setOpen(false) : openMenu())}
					className={[
						"flex w-full cursor-pointer items-center gap-2 rounded-md border bg-surface-card text-left shadow-xs",
						"font-sans font-normal leading-normal text-text-body transition-colors duration-150",
						open
							? "border-border-accent"
							: "border-border-default hover:border-border-strong hover:bg-surface-hover",
						"disabled:cursor-not-allowed disabled:opacity-45",
						SIZE_CLASSES[size].trigger,
						SIZE_CLASSES[size].text,
					].join(" ")}
				>
					<span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-text-subtle"}`}>
						{selected ? selected.label : placeholder}
					</span>
					<motion.span
						animate={{ rotate: open ? 180 : 0 }}
						transition={TRANSITIONS.snap}
						className="inline-flex text-text-subtle"
					>
						<ChevronDown aria-hidden="true" size={14} strokeWidth={1.75} />
					</motion.span>
				</button>
			)}

			<AnimatePresence>
				{open ? (
					<motion.ul
						ref={listRef}
						id={listboxId}
						role="listbox"
						aria-activedescendant={entries[highlighted] ? `${id}-opt-${highlighted}` : undefined}
						{...VARIANTS.pop}
						style={{ zIndex: "var(--z-dropdown)" }}
						className={
							icon
								? "absolute right-0 top-full mt-1.5 max-h-72 min-w-[12rem] overflow-y-auto rounded-lg border border-border-default bg-surface-raised p-1 shadow-md"
								: "absolute left-0 top-full mt-1.5 max-h-72 w-full min-w-[12rem] overflow-y-auto rounded-lg border border-border-default bg-surface-raised p-1 shadow-md"
						}
					>
						{entries.map((entry, index) => {
							const isSelected = entry.value === current;
							const isActive = index === highlighted;
							return (
								<li
									key={entry.value}
									id={`${id}-opt-${index}`}
									role="option"
									aria-selected={isSelected}
									onPointerEnter={() => setHighlighted(index)}
									onClick={() => select(entry.value)}
									className={`relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${isActive ? "text-text-heading" : ""}`}
								>
									{isActive ? (
										<motion.span
											layoutId={`${id}-highlight`}
											transition={TRANSITIONS.snap}
											className="absolute inset-0 rounded-md bg-surface-hover ring-1 ring-inset ring-border-default"
											aria-hidden="true"
										/>
									) : null}
									<span className="relative flex min-w-0 flex-1 flex-col">
										<span
											className={`truncate font-sans leading-normal ${SIZE_CLASSES[size].text} ${isSelected ? "font-semibold text-text-accent" : "font-medium text-text-body"}`}
										>
											{entry.label}
										</span>
										{entry.description ? (
											<span className="truncate font-sans text-[length:var(--size-xs)] font-normal leading-snug text-text-muted">
												{entry.description}
											</span>
										) : null}
									</span>
									<span
										className={`relative inline-flex w-3.5 shrink-0 justify-center text-text-accent ${isSelected ? "" : "invisible"}`}
									>
										<Check aria-hidden="true" size={14} strokeWidth={2} />
									</span>
								</li>
							);
						})}
					</motion.ul>
				) : null}
			</AnimatePresence>
		</div>
	);
}
