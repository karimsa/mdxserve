import { motion } from "framer-motion";
import { CommentsPanel } from "./CommentsPanel";
import type { CommentsModel } from "./model";
import { SLIDE, SLIDE_BLEED, SLIDE_OUT } from "./motion";

/**
 * Desktop panel: 348px, full height under the top bar, fixed to the window's
 * right edge. It slides in over the right-hand track AppShell reserves beside
 * the doc (the one the table-of-contents rail sits in), so it never covers
 * the doc. Render it inside an `AnimatePresence` for the exit.
 *
 * The slide is a spring that overshoots slightly, so the panel is wider than
 * it looks: `SLIDE_BLEED` of padding hangs off the window's right edge and
 * comes into view only while the spring is past its resting point.
 */
export const COMMENTS_SIDEBAR_WIDTH = 348;
export function CommentsSidebar({ model, onClose }: { model: CommentsModel; onClose: () => void }) {
	return (
		<motion.aside
			data-print-hide
			aria-label="Comments"
			initial={{ x: "100%" }}
			animate={{ x: 0 }}
			exit={{ x: "100%", transition: SLIDE_OUT }}
			transition={SLIDE}
			style={{
				width: COMMENTS_SIDEBAR_WIDTH + SLIDE_BLEED,
				right: -SLIDE_BLEED,
				paddingRight: SLIDE_BLEED,
			}}
			className="fixed top-topbar bottom-0 z-[var(--z-sticky)] flex flex-col border-l border-border-default bg-surface-page shadow-lg"
		>
			<CommentsPanel model={model} variant="sidebar" onClose={onClose} />
		</motion.aside>
	);
}
