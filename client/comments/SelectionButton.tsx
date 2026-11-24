import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import type { AnchorFields } from "./anchor";
import { captureSelection } from "./dom";
import { useCommentsPanel, type CommentsModel } from "./model";
import { draftAtom, popoverThreadAtom } from "./state";

const SETTLE_MS = 60;

interface Pending {
	anchor: AnchorFields;
	range: Range;
}

/** The "Comment" button floating next to a selection. */
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
		setPending({ anchor, range: selection.getRangeAt(0).cloneRange() });
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

	// Above the selection with a pointer, below it on touch, where the system menu sits above.
	useLayoutEffect(() => {
		const floating = buttonRef.current;
		if (!pending || !floating) return;
		const reference = {
			getBoundingClientRect: () => pending.range.getBoundingClientRect(),
			getClientRects: () => pending.range.getClientRects(),
		};
		const touch = pointerType.current === "touch" || window.matchMedia("(pointer: coarse)").matches;
		return autoUpdate(reference, floating, () => {
			void computePosition(reference, floating, {
				strategy: "fixed",
				placement: touch ? "bottom" : "top",
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
	const { anchor, range } = pending;

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
					nonce: (previous?.nonce ?? 0) + 1,
				}));
				// Desktop: the composer opens in a popover, whether or not the sidebar is
				// open. Phone: it opens in the sheet.
				setPopover(null);
				if (!isDesktop) setOpen(true);
				setPending(null);
			}}
			style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
			className="z-[var(--z-dropdown)] inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border-default bg-surface-raised px-2.5 font-sans text-[length:var(--size-sm)] font-semibold text-text-heading shadow-md hover:bg-surface-hover"
		>
			<Icon name="message-square" size="sm" />
			Comment
		</button>
	);
}
