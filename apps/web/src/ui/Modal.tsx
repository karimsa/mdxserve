import { useEffect, useRef, type Ref } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps } from "framer-motion";
import { VARIANTS } from "../motion";

type ModalProps = Omit<HTMLMotionProps<"dialog">, "onClose" | "onCancel" | "ref" | "open"> & {
	open: boolean;
	onClose?: () => void;
	onExitComplete?: () => void;
	/** Disable Escape and backdrop dismissal while an operation is pending. */
	dismissible?: boolean;
	dismissOnBackdrop?: boolean;
	/** Override backdrop dismissal, for example to protect an unsaved draft. */
	onBackdropClick?: () => void;
	placement?: "top" | "center";
	panelRef?: Ref<HTMLDialogElement>;
	initialFocus?: string;
};

// A parent and its nested modal can unmount in either order.
const scrollLocks = new WeakMap<Document, { count: number; overflow: string }>();

/**
 * Native modality supplies focus containment, focus return and nested top-layer ordering.
 * Toggle `open` to close, or wrap a conditionally mounted owner in AnimatePresence.
 * Exit propagation keeps the native dialog open until its panel has finished fading.
 */
export function Modal({ open, onExitComplete, ...props }: ModalProps) {
	if (typeof document === "undefined") return null;
	return createPortal(
		<AnimatePresence propagate onExitComplete={onExitComplete}>
			{open && <ModalSurface key="modal" {...props} />}
		</AnimatePresence>,
		document.body,
	);
}

function ModalSurface({
	onClose,
	dismissible = true,
	dismissOnBackdrop = true,
	onBackdropClick,
	placement = "center",
	panelRef,
	initialFocus,
	className = "",
	children,
	onKeyDown,
	...props
}: Omit<ModalProps, "open">) {
	const present = useIsPresent();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const backdropPress = useRef(false);
	useEffect(() => {
		const dialog = dialogRef.current!;
		const previousFocus = document.activeElement;
		const scrollLock = scrollLocks.get(document) ?? {
			count: 0,
			overflow: document.body.style.overflow,
		};
		scrollLock.count += 1;
		scrollLocks.set(document, scrollLock);
		dialog.showModal();
		if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
		document.body.style.overflow = "hidden";
		return () => {
			dialog.close();
			scrollLock.count -= 1;
			if (scrollLock.count === 0) {
				document.body.style.overflow = scrollLock.overflow;
				scrollLocks.delete(document);
			}
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
		};
	}, [initialFocus]);

	function isBackdrop(event: React.MouseEvent<HTMLDialogElement>) {
		const bounds = event.currentTarget.getBoundingClientRect();
		return (
			event.target === event.currentTarget &&
			(event.clientX < bounds.left ||
				event.clientX > bounds.right ||
				event.clientY < bounds.top ||
				event.clientY > bounds.bottom)
		);
	}

	return (
		<motion.dialog
			{...VARIANTS.pop}
			{...props}
			ref={(dialog) => {
				dialogRef.current = dialog;
				if (typeof panelRef === "function") return panelRef(dialog);
				if (panelRef) panelRef.current = dialog;
			}}
			aria-modal="true"
			data-exiting={!present || undefined}
			className={`modal modal--${placement} ${className}`}
			onCancel={(event) => {
				event.preventDefault();
				event.stopPropagation();
				if (present && dismissible) onClose?.();
			}}
			onKeyDown={(event) => {
				onKeyDown?.(event);
				event.stopPropagation();
			}}
			onPointerDown={(event) => {
				backdropPress.current = isBackdrop(event);
			}}
			onClick={(event) => {
				event.stopPropagation();
				const outside = backdropPress.current && isBackdrop(event);
				backdropPress.current = false;
				if (present && outside && dismissible && dismissOnBackdrop)
					(onBackdropClick ?? onClose)?.();
			}}
		>
			{children}
		</motion.dialog>
	);
}
