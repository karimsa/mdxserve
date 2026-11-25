import { AnimatePresence, motion } from "framer-motion";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { TRANSITIONS } from "../motion";
import { CommentsPanel } from "./CommentsPanel";
import type { CommentsModel } from "./model";
import { draftAtom } from "./state";

/** Phone-width panel: rises from the bottom, 70% of the screen at most, list scrolls inside. Same header and threads as the sidebar. */
export function CommentsSheet({
	model,
	open,
	onClose,
}: {
	model: CommentsModel;
	open: boolean;
	onClose: () => void;
}) {
	const hasDraft = useAtomValue(draftAtom) !== null;

	// Escape discards a draft first (SelectionButton); the sheet closes on the next one.
	useEffect(() => {
		if (!open || hasDraft) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") onClose();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, hasDraft, onClose]);

	// Reserve scroll room so text at the end of the doc can be scrolled above the sheet.
	useEffect(() => {
		if (!open) return;
		const previous = document.body.style.paddingBottom;
		document.body.style.paddingBottom = "70vh";
		return () => {
			document.body.style.paddingBottom = previous;
		};
	}, [open]);

	return (
		<AnimatePresence>
			{open ? (
				<motion.aside
					key="comments-sheet"
					data-print-hide
					aria-label="Comments"
					initial={{ y: "100%" }}
					animate={{ y: 0 }}
					exit={{ y: "100%" }}
					transition={TRANSITIONS.glide}
					className="fixed inset-x-0 bottom-0 z-[var(--z-modal)] flex max-h-[70vh] flex-col rounded-t-[16px] bg-surface-card shadow-lg md:hidden"
				>
					<span
						aria-hidden
						className="mx-auto mt-2 mb-0.5 h-1 w-9 shrink-0 rounded-full bg-border-strong"
					/>
					<CommentsPanel model={model} variant="sheet" onClose={onClose} />
				</motion.aside>
			) : null}
		</AnimatePresence>
	);
}
