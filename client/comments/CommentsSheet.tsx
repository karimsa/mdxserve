import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { TRANSITIONS } from "../motion";
import { CommentsPanel } from "./CommentsPanel";
import type { CommentsModel } from "./model";

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
	useEffect(() => {
		if (!open) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") onClose();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

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
