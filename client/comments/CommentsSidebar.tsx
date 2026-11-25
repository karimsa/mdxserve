import { CommentsPanel } from "./CommentsPanel";
import type { CommentsModel } from "./model";

/**
 * Desktop column: 348px, full height under the top bar, flush to the window's
 * right edge. A sibling of `<main>` in AppShell, so the doc column narrows to make room.
 */
export function CommentsSidebar({ model, onClose }: { model: CommentsModel; onClose: () => void }) {
	return (
		<aside
			data-print-hide
			aria-label="Comments"
			className="sticky top-topbar flex h-[calc(100vh-var(--topbar-height))] w-[348px] shrink-0 flex-col border-l border-border-default bg-surface-page"
		>
			<CommentsPanel model={model} variant="sidebar" onClose={onClose} />
		</aside>
	);
}
