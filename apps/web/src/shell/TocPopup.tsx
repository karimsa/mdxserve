import { LayoutGroup } from "framer-motion";
import { useMediaQuery } from "../hooks";
import { BottomSheet } from "../ui/BottomSheet";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import { TocList } from "../ui/TocList";
import type { DocToc } from "./useDocToc";

/** Below Tailwind's `md`, where BottomSheet is shown. */
const SHEET_MEDIA = "(max-width: 767px)";

/**
 * The table of contents brought out by the top-bar button: a bottom sheet on a
 * phone, a floating window like the search palette everywhere else. Picking a
 * heading goes there and puts the list away again.
 */
export function TocPopup({ toc }: { toc: DocToc }) {
	const asSheet = useMediaQuery(SHEET_MEDIA);

	function pick(id: string) {
		toc.closePopup();
		toc.select(id);
	}

	// Its own layout group: the rail can be mounted (hidden) at the same time,
	// and both lists carry the same active-marker layoutId.
	const list = (
		<LayoutGroup id="toc-popup">
			<TocList items={toc.items} activeId={toc.activeId} onSelect={pick} title={null} />
		</LayoutGroup>
	);

	if (asSheet) {
		return (
			<BottomSheet open={toc.popupOpen} onClose={toc.closePopup} label="On this page" scrim>
				{(dragHandlers) => (
					<>
						<div
							{...dragHandlers}
							className="flex h-[42px] shrink-0 touch-none items-center border-b border-border-subtle pr-2 pl-4"
						>
							<span className="flex-1 font-sans text-[length:var(--size-sm)] font-semibold text-text-heading">
								On this page
							</span>
							<IconButton
								icon="x"
								label="Close table of contents"
								size="sm"
								className="h-9 w-9"
								onClick={toc.closePopup}
							/>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-6">
							{list}
						</div>
					</>
				)}
			</BottomSheet>
		);
	}

	return (
		<Modal
			open={toc.popupOpen}
			onClose={toc.closePopup}
			placement="top"
			aria-label="On this page"
			className="w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden"
		>
			<div className="flex h-12 items-center border-b border-border-subtle pr-2 pl-4">
				<span className="flex-1 font-sans text-[length:var(--size-sm)] font-semibold text-text-heading">
					On this page
				</span>
				<IconButton icon="x" label="Close table of contents" size="sm" onClick={toc.closePopup} />
			</div>
			<div className="max-h-[min(60vh,520px)] overflow-y-auto px-4 py-3">{list}</div>
		</Modal>
	);
}
