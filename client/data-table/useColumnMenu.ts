import { useEffect, useRef, useState, type RefObject } from "react";
import { autoUpdate, computePosition, flip, offset, shift, size } from "@floating-ui/dom";

function observeColumnMenu(
	anchor: HTMLButtonElement,
	popup: HTMLDivElement,
	onPositioned: () => void,
	onDismiss: () => void,
) {
	popup.inert = false;
	popup.style.pointerEvents = "auto";
	let disposed = false;

	const cleanup = autoUpdate(anchor.closest("th") ?? anchor, popup, () => {
		void computePosition(anchor.closest("th") ?? anchor, popup, {
			placement: "bottom-start",
			strategy: "fixed",
			middleware: [
				offset(6),
				flip(),
				shift({ padding: 8 }),
				size({
					padding: 8,
					apply({ availableHeight }) {
						popup.style.maxHeight = `${Math.max(0, availableHeight)}px`;
					},
				}),
			],
		}).then(({ x, y }) => {
			if (disposed) return;
			Object.assign(popup.style, { left: `${x}px`, top: `${y}px` });
			onPositioned();
		});
	});

	const dismiss = (event: PointerEvent) => {
		if (
			!popup.contains(event.target as Node) &&
			!anchor.parentElement?.contains(event.target as Node)
		)
			onDismiss();
	};

	document.addEventListener("pointerdown", dismiss);

	return () => {
		disposed = true;
		cleanup();
		document.removeEventListener("pointerdown", dismiss);
		popup.inert = true;
		popup.style.pointerEvents = "none";
	};
}

export function useColumnMenu(
	open: boolean,
	onOpenChange: (open: boolean) => void,
	trigger: RefObject<HTMLButtonElement | null>,
	menu: RefObject<HTMLDivElement | null>,
) {
	const [positioned, setPositioned] = useState(false);
	const change = useRef(onOpenChange);
	change.current = onOpenChange;

	useEffect(() => {
		if (!open) {
			setPositioned(false);
			return;
		}
		if (!trigger.current || !menu.current) return;
		return observeColumnMenu(
			trigger.current,
			menu.current,
			() => setPositioned(true),
			() => change.current(false),
		);
	}, [open, trigger, menu]);

	useEffect(() => {
		if (open && positioned) menu.current?.querySelector<HTMLInputElement>("input")?.focus();
	}, [open, positioned, menu]);

	return positioned;
}
