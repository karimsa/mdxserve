import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { BottomSheet } from "../ui/BottomSheet";
import { CommentsPanel } from "./CommentsPanel";
import type { CommentsModel } from "./model";
import { draftAtom } from "./state";

/** Phone-width comments panel: a bottom sheet with the same header and threads as the sidebar. */
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
		<BottomSheet
			open={open}
			onClose={onClose}
			label="Comments"
			marker="data-comments-sheet"
			// Escape discards a draft first (SelectionButton); the sheet closes on the next one.
			closeOnEscape={!hasDraft}
		>
			{(dragHandlers) => (
				<CommentsPanel model={model} variant="sheet" onClose={onClose} headerDrag={dragHandlers} />
			)}
		</BottomSheet>
	);
}
