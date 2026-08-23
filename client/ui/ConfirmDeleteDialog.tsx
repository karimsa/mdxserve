import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { formatModified, formatSize } from "../format";
import Button from "../builtins/Button";
import type { ListingEntry } from "../router";
import { Icon } from "./Icon";
import { V } from "../motion";

export function ConfirmDeleteDialog({
	open,
	files,
	pending,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	/** Selected file entries, in listing order. */
	files: ListingEntry[];
	pending: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	// Document-level, not panel-level: while a delete is pending both buttons
	// are disabled and the browser drops focus to <body>, so a panel onKeyDown
	// would stop hearing Escape (e.g. after a failed request leaves the dialog
	// open).
	useEffect(() => {
		if (!open) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape" && !pending) {
				event.preventDefault();
				onCancel();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, pending, onCancel]);

	// Portal to <body>: this renders inside the route wrapper, whose fadeRise
	// transform would otherwise turn `fixed` into "fixed to the column" and let
	// the scrim miss the top bar and sidebar.
	return createPortal(
		<AnimatePresence>
			{open ? (
				<motion.div
					key="scrim"
					onClick={pending ? undefined : onCancel}
					{...V.scrim}
					className="fixed inset-0 z-[var(--z-modal)] flex justify-center bg-[var(--scrim)] pt-[10vh] backdrop-blur-sm"
				>
					<motion.div
						onClick={(event) => event.stopPropagation()}
						{...V.pop}
						role="alertdialog"
						aria-modal="true"
						aria-labelledby="confirm-delete-title"
						className="w-[560px] max-w-[92vw] self-start overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-lg"
					>
						<div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
							<Icon name="trash-2" size="md" className="text-status-danger-fg" />
							<div className="flex flex-col">
								<span
									id="confirm-delete-title"
									className="font-sans font-semibold text-text-heading text-[length:var(--size-md)]"
								>
									Delete {files.length} {files.length === 1 ? "file" : "files"}?
								</span>
								<span className="font-sans text-[length:var(--size-sm)] text-text-muted">
									They&rsquo;ll be moved to the system Trash — this can be undone from there.
								</span>
							</div>
						</div>
						<div className="max-h-72 overflow-y-auto p-2">
							{files.map((file) => (
								<div key={file.name} className="flex items-center gap-2 rounded-md px-2 py-1.5">
									<Icon name="file-text" size="sm" className="shrink-0 text-text-subtle" />
									<span className="truncate font-mono text-[length:var(--size-sm)]">
										{file.name}
									</span>
									<span className="ml-auto flex shrink-0 gap-4 pl-4 font-mono text-[length:var(--size-xs)] text-text-subtle tabular-nums">
										{typeof file.mtime === "number" ? (
											<span>{formatModified(file.mtime)}</span>
										) : null}
										{typeof file.size === "number" ? (
											<span className="w-16 text-right">{formatSize(file.size)}</span>
										) : null}
									</span>
								</div>
							))}
						</div>
						<div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
							{/* Start keyboard focus on the safe action. */}
							<Button variant="secondary" size="sm" autoFocus disabled={pending} onClick={onCancel}>
								Cancel
							</Button>
							<Button
								variant="danger"
								size="sm"
								icon="trash-2"
								disabled={pending}
								onClick={onConfirm}
							>
								{pending ? "Moving…" : "Move to Trash"}
							</Button>
						</div>
					</motion.div>
				</motion.div>
			) : null}
		</AnimatePresence>,
		document.body,
	);
}
