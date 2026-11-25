import { CommentsPanel } from "./CommentsPanel";
import type { CommentsModel } from "./model";

export const COMMENTS_SIDEBAR_WIDTH = 348;

/**
 * Desktop column: 348px, full height under the top bar, flush to the window's
 * right edge. AppShell docks it beside `<main>` in a wrapper whose width opens
 * and closes, so the doc column narrows to make room. The column itself keeps
 * its full width throughout and is clipped by that wrapper: its contents slide
 * in from the right edge without reflowing.
 */
export function CommentsSidebar({ model, onClose }: { model: CommentsModel; onClose: () => void }) {
	return (
		<aside
			data-print-hide
			aria-label="Comments"
			style={{ width: COMMENTS_SIDEBAR_WIDTH }}
			className="sticky top-topbar flex h-[calc(100vh-var(--topbar-height))] shrink-0 flex-col border-l border-border-default bg-surface-page"
		>
			<CommentsPanel model={model} variant="sidebar" onClose={onClose} />
		</aside>
	);
}
