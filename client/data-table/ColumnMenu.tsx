import { useId, useRef, type ReactNode, type KeyboardEvent, type FocusEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { enterTransition, exitTransition } from "../motion";
import { createPortal } from "react-dom";
import { useColumnMenu } from "./useColumnMenu";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";

function closeColumnMenu(onOpenChange: (open: boolean) => void, trigger: HTMLButtonElement | null) {
	onOpenChange(false);
	trigger?.focus();
}

function handleHeaderKey(
	event: KeyboardEvent<HTMLButtonElement>,
	onSort: () => void,
	onOpenChange: (open: boolean) => void,
	onNavigate: (event: KeyboardEvent<HTMLButtonElement>) => void,
) {
	if (event.key === " ") {
		event.preventDefault();
		onSort();
	} else if (event.key === "Enter") {
		event.preventDefault();
		onOpenChange(true);
	} else {
		onNavigate(event);
	}
}

function handleMenuKey(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
	if (event.key !== "Escape") return;

	event.preventDefault();
	event.stopPropagation();
	close();
}

function handleMenuBlur(
	event: FocusEvent<HTMLDivElement>,
	trigger: HTMLButtonElement | null,
	onOpenChange: (open: boolean) => void,
) {
	const nextTarget = event.relatedTarget;
	if (
		!nextTarget ||
		event.currentTarget.contains(nextTarget) ||
		trigger?.parentElement?.contains(nextTarget)
	)
		return;

	onOpenChange(false);
}

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
	const positioned = useColumnMenu(open, onOpenChange, trigger, menu);
	const close = () => closeColumnMenu(onOpenChange, trigger.current);

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
					onKeyDown={(event) => handleHeaderKey(event, onSort, onOpenChange, onNavigate)}
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
								onKeyDown={(event) => handleMenuKey(event, close)}
								onBlur={(event) => handleMenuBlur(event, trigger.current, onOpenChange)}
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
