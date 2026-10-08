import { useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { enterTransition, exitTransition } from "../motion";
import { createPortal } from "react-dom";
import { autoUpdate, computePosition, flip, offset, shift, size } from "@floating-ui/dom";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";

/** Portaled to escape the table scroller, positioned against the triggering header. */
export function ColumnMenu({
	label,
	unit,
	indicator,
	open,
	onOpenChange,
	onActivate,
	onSort,
	onNavigate,
	tabIndex,
	children,
}: {
	label: string;
	unit?: string;
	indicator?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onActivate: () => void;
	onSort: () => void;
	onNavigate: (event: KeyboardEvent<HTMLButtonElement>) => void;
	tabIndex: number;
	children: (close: () => void) => ReactNode;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const menuId = useId();
	const reducedMotion = useReducedMotion();
	const [positioned, setPositioned] = useState(false);
	const change = useRef(onOpenChange);
	change.current = onOpenChange;
	const close = () => {
		onOpenChange(false);
		trigger.current?.focus();
	};
	useEffect(() => {
		if (!open) {
			setPositioned(false);
			return;
		}
		if (!trigger.current || !menu.current) return;
		const anchor = trigger.current;
		const popup = menu.current;
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
				setPositioned(true);
			});
		});

		const dismiss = (event: PointerEvent) => {
			if (
				!popup.contains(event.target as Node) &&
				!anchor.parentElement?.contains(event.target as Node)
			)
				change.current(false);
		};
		document.addEventListener("pointerdown", dismiss);
		return () => {
			disposed = true;
			cleanup();
			document.removeEventListener("pointerdown", dismiss);
			popup.inert = true;
			popup.style.pointerEvents = "none";
		};
	}, [open]);
	useEffect(() => {
		if (open && positioned) menu.current?.querySelector<HTMLInputElement>("input")?.focus();
	}, [open, positioned]);

	return (
		<>
			<div className="data-table-header-control">
				<button
					ref={trigger}
					type="button"
					className="data-table-heading"
					aria-label={`${label} column header`}
					aria-keyshortcuts="Space Enter ArrowUp ArrowDown ArrowLeft ArrowRight"
					tabIndex={tabIndex}
					onFocus={onActivate}
					aria-haspopup="dialog"
					aria-expanded={open}
					aria-controls={open ? menuId : undefined}
					onClick={() => {
						onActivate();
						onOpenChange(false);
					}}
					onKeyDown={(event) => {
						if (event.key === " ") {
							event.preventDefault();
							onSort();
						} else if (event.key === "Enter") {
							event.preventDefault();
							onOpenChange(true);
						} else onNavigate(event);
					}}
				>
					<span>{label}</span>
					{unit && <span className="data-table-unit">· {unit}</span>}
					{indicator && <span className="data-table-indicator">{indicator}</span>}
				</button>
				<button
					type="button"
					className="data-table-header-chevron"
					tabIndex={-1}
					aria-label={`${label} column options`}
					aria-haspopup="dialog"
					aria-expanded={open}
					aria-controls={open ? menuId : undefined}
					onClick={() => {
						onActivate();
						if (open) close();
						else onOpenChange(true);
					}}
				>
					<ChevronDown size={12} aria-hidden="true" />
				</button>
			</div>
			{typeof document !== "undefined" &&
				createPortal(
					<AnimatePresence>
						{open && (
							<motion.div
								key="menu"
								initial={{ opacity: 0, y: reducedMotion ? 0 : -4, scale: reducedMotion ? 1 : 0.98 }}
								animate={
									positioned
										? { opacity: 1, y: 0, scale: 1 }
										: { opacity: 0, y: reducedMotion ? 0 : -4, scale: reducedMotion ? 1 : 0.98 }
								}
								exit={{
									opacity: 0,
									y: reducedMotion ? 0 : -3,
									scale: reducedMotion ? 1 : 0.98,
									transition: reducedMotion ? { duration: 0 } : exitTransition,
								}}
								transition={reducedMotion ? { duration: 0 } : enterTransition}
								id={menuId}
								ref={menu}
								className="data-table-menu"
								role="dialog"
								aria-label={`${label} column options`}
								style={{ transformOrigin: "top left" }}
								onDoubleClick={(event) => event.stopPropagation()}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										event.stopPropagation();
										close();
									}
								}}
								onBlur={(event) => {
									if (
										event.relatedTarget &&
										!event.currentTarget.contains(event.relatedTarget as Node) &&
										!trigger.current?.parentElement?.contains(event.relatedTarget as Node)
									)
										onOpenChange(false);
								}}
							>
								<div className="data-table-menu-title">{label}</div>
								{children(close)}
							</motion.div>
						)}
					</AnimatePresence>,
					document.body,
				)}
		</>
	);
}
