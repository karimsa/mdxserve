import { AnimatePresence, motion, type Transition } from "framer-motion";
import { useAtomValue } from "jotai";
import { useKeyboardInset } from "./hooks";
import { sectionEditorActionsAtom } from "./state";

/** Loose enough to overshoot a little on the way in and settle. */
const BAR_SPRING = { type: "spring", stiffness: 420, damping: 22, mass: 0.9 } satisfies Transition;

const BAR_AWAY = { opacity: 0, y: 28, scale: 0.85 };

/**
 * Save and Cancel for the section editor on touch and phone-width screens,
 * where there is no Esc or ⌘S. A pill fixed at the bottom centre that springs
 * in when a section opens for editing and out when it closes, and rides above
 * the on-screen keyboard.
 */
export function EditorActionBar() {
	const actions = useAtomValue(sectionEditorActionsAtom);
	const { inset } = useKeyboardInset();

	return (
		<AnimatePresence>
			{actions ? (
				<motion.div
					key="editor-actions"
					data-print-hide
					data-editor-actions
					initial={BAR_AWAY}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					exit={BAR_AWAY}
					transition={BAR_SPRING}
					// `x` rather than a translate class: motion owns this element's transform.
					style={{ x: "-50%", bottom: `calc(env(safe-area-inset-bottom, 0px) + ${inset + 12}px)` }}
					className="fixed left-1/2 z-[var(--z-dropdown)] hidden items-center gap-1 rounded-full border border-border-default bg-surface-card p-1 shadow-lg transition-[bottom] duration-200 ease-out max-md:flex [@media(pointer:coarse)]:flex"
				>
					<button
						type="button"
						disabled={actions.saving}
						onClick={actions.cancel}
						className="h-9 cursor-pointer rounded-full border-0 bg-transparent px-4 font-sans text-[length:var(--size-sm)] font-semibold text-text-muted active:bg-surface-hover disabled:opacity-60"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={actions.saving}
						onClick={actions.save}
						className="h-9 cursor-pointer rounded-full border-0 bg-surface-accent px-4 font-sans text-[length:var(--size-sm)] font-semibold text-text-inverse disabled:opacity-60"
					>
						{actions.saving ? "Saving…" : "Save"}
					</button>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
