import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import type { AnchorFields } from "@mdxserve/client/comments/anchor";
import { captureSelection } from "./dom";
import { useCommentsPanel, type CommentsModel } from "./model";
import { draftAtom, popoverThreadAtom } from "./state";

const SETTLE_MS = 60;

/** Gap between the docked button and the screen's bottom edge, or the open sheet's top. */
const DOCK_GAP = 16;

interface Pending {
	anchor: AnchorFields;
	range: Range;
	/**
	 * On touch, the distance from the bottom of the screen the button is docked
	 * at; null with a mouse, where it floats beside the selection.
	 */
	dock: number | null;
}

/**
 * Touch screens show their own selection menu (Copy, Look Up, …) beside the
 * selection. A page cannot add to that menu or learn which side it took, so a
 * button placed near the selection ends up underneath it. Dock ours at the
 * bottom of the screen instead: the system menu only goes below a selection
 * when there is room for it there, so it never reaches the dock. The comments
 * sheet covers the bottom of the screen when open, so dock just above it.
 * @internal Exported for its tests.
 */
export function dockOffset(): number {
	const sheet = document.querySelector("[data-comments-sheet]");
	const covered = sheet ? Math.max(0, window.innerHeight - sheet.getBoundingClientRect().top) : 0;
	return covered + DOCK_GAP;
}

/** The "Comment" button floating next to a selection. */
// Never reused, so a finished submission can tell its own draft from a later one
// even after the draft was discarded in between.
let draftNonce = 0;
function nextDraftNonce(): number {
	draftNonce += 1;
	return draftNonce;
}

export function SelectionButton({ model }: { model: CommentsModel }) {
	const [pending, setPending] = useState<Pending | null>(null);
	const [draft, setDraft] = useAtom(draftAtom);
	const setPopover = useSetAtom(popoverThreadAtom);
	const { isDesktop, setOpen } = useCommentsPanel();
	const buttonRef = useRef<HTMLButtonElement>(null);
	const pointerType = useRef("mouse");
	const pointerDown = useRef(false);
	const enabled = !model.writesDisabled && model.path !== "";

	const refresh = useCallback(() => {
		const selection = window.getSelection();
		const anchor = enabled && !pointerDown.current ? captureSelection(selection) : null;
		if (!anchor || !selection) {
			setPending(null);
			return;
		}
		const touch = pointerType.current === "touch" || window.matchMedia("(pointer: coarse)").matches;
		setPending({
			anchor,
			range: selection.getRangeAt(0).cloneRange(),
			dock: touch ? dockOffset() : null,
		});
	}, [enabled]);

	useEffect(() => {
		if (!enabled) {
			setPending(null);
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		function onSelectionChange() {
			clearTimeout(timer);
			timer = setTimeout(refresh, SETTLE_MS);
		}
		function onPointerDown(event: PointerEvent) {
			pointerType.current = event.pointerType;
			if (event.pointerType === "mouse") pointerDown.current = true;
		}
		function onPointerUp(event: PointerEvent) {
			pointerType.current = event.pointerType;
			pointerDown.current = false;
			// Let the browser finish the selection this release completes.
			requestAnimationFrame(refresh);
		}
		document.addEventListener("selectionchange", onSelectionChange);
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("pointerup", onPointerUp, true);
		refresh();
		return () => {
			clearTimeout(timer);
			document.removeEventListener("selectionchange", onSelectionChange);
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("pointerup", onPointerUp, true);
		};
	}, [enabled, refresh]);

	// With a mouse the button floats above the selection. On touch it is docked
	// (see dockOffset) and positioned by its style alone.
	useLayoutEffect(() => {
		const floating = buttonRef.current;
		if (!pending || pending.dock !== null || !floating) return;
		const reference = {
			getBoundingClientRect: () => pending.range.getBoundingClientRect(),
			getClientRects: () => pending.range.getClientRects(),
		};
		return autoUpdate(reference, floating, () => {
			void computePosition(reference, floating, {
				strategy: "fixed",
				placement: "top",
				middleware: [offset(8), flip(), shift({ padding: 8 })],
			}).then(({ x, y }) => {
				floating.style.left = `${x}px`;
				floating.style.top = `${y}px`;
				floating.style.visibility = "visible";
			});
		});
	}, [pending]);

	// Escape discards the draft.
	useEffect(() => {
		if (!draft) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") setDraft(null);
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [draft, setDraft]);

	if (!pending) return null;
	const { anchor, range, dock } = pending;
	const docked = dock !== null;

	return (
		<button
			ref={buttonRef}
			type="button"
			data-print-hide
			data-comments-keep
			// Keep the selection alive through the press.
			onPointerDown={(event) => event.preventDefault()}
			onMouseDown={(event) => event.preventDefault()}
			onClick={() => {
				setDraft((previous) => ({
					anchor,
					range,
					body: previous?.body ?? "",
					nonce: nextDraftNonce(),
				}));
				// Desktop: the composer opens in a popover, whether or not the sidebar is
				// open. Phone: it opens in the sheet.
				setPopover(null);
				if (!isDesktop) setOpen(true);
				setPending(null);
			}}
			// Keyed by mode: the floating button's position is written to the element
			// directly, and must not leak into the docked one.
			key={docked ? "docked" : "floating"}
			style={
				docked
					? {
							position: "fixed",
							left: "50%",
							bottom: `calc(env(safe-area-inset-bottom, 0px) + ${dock}px)`,
							translate: "-50% 0",
						}
					: { position: "fixed", left: 0, top: 0, visibility: "hidden" }
			}
			className={
				"inline-flex cursor-pointer items-center border border-border-default bg-surface-raised font-sans font-semibold text-text-heading hover:bg-surface-hover " +
				(docked
					? // Above the sheet, which this can sit over the edge of.
						"z-[var(--z-toast)] h-11 gap-2 rounded-full px-5 text-[length:var(--size-md)] shadow-lg"
					: "z-[var(--z-dropdown)] h-8 gap-1.5 rounded-md px-2.5 text-[length:var(--size-sm)] shadow-md")
			}
		>
			<Icon name="message-square" size="sm" />
			Comment
		</button>
	);
}
