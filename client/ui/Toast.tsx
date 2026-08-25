import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { AnimatePresence, motion, type MotionProps } from "framer-motion";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { VARIANTS } from "../motion";

export type ToastTone = "info" | "ok" | "warn" | "danger";

// `title` shadows the native HTML tooltip attribute (typed `string` on
// `HTMLAttributes`), and motion.div-owned event props need the same
// treatment as elsewhere — see IconButton.tsx.
export interface ToastProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	"title" | keyof MotionProps
> {
	tone?: ToastTone;
	title: ReactNode;
	message?: ReactNode;
	/** Overrides the tone's default Lucide icon. */
	icon?: string;
	onClose?: () => void;
}

const TONE_ICON: Record<ToastTone, string> = {
	info: "info",
	ok: "circle-check",
	warn: "triangle-alert",
	danger: "octagon-alert",
};

const TONE_FG: Record<ToastTone, string> = {
	info: "text-status-info-fg",
	ok: "text-status-ok-fg",
	warn: "text-status-warn-fg",
	danger: "text-status-danger-fg",
};

/** A single toast card. Used directly, or via `ToastStack` + `pushToast`. */
export function Toast({
	tone = "info",
	title,
	message,
	icon,
	onClose,
	className,
	...rest
}: ToastProps) {
	return (
		<motion.div
			role="status"
			layout
			{...VARIANTS.slideUp}
			className={
				"flex w-[340px] items-start gap-3 rounded-lg border border-border-default bg-surface-raised py-3 pr-3 pl-4 shadow-md" +
				(className ? " " + className : "")
			}
			{...rest}
		>
			<Icon
				name={icon ?? TONE_ICON[tone]}
				size="md"
				className={"mt-0.5 shrink-0 " + TONE_FG[tone]}
			/>
			<div className="min-w-0 flex-1">
				<div className="text-[15px] leading-normal font-semibold text-text-heading">{title}</div>
				{message ? (
					<div className="mt-0.5 text-[13px] leading-normal font-normal text-text-muted">
						{message}
					</div>
				) : null}
			</div>
			{onClose ? <IconButton icon="x" label="Dismiss" size="sm" onClick={onClose} /> : null}
		</motion.div>
	);
}

/* ── Module-level toast store: a plain array + subscriber set, so any part of
   the app can call `pushToast` without a provider. ── */

interface ToastData {
	id: number;
	title: ReactNode;
	message?: ReactNode;
	tone?: ToastTone;
	icon?: string;
}

let toasts: ToastData[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

const AUTO_DISMISS_MS = 4000;

export function dismissToast(id: number): void {
	toasts = toasts.filter((toast) => toast.id !== id);
	emit();
}

/** Queues a toast; it auto-dismisses after 4s. */
export function pushToast(toast: Omit<ToastData, "id">): number {
	const id = nextId++;
	toasts = [...toasts, { ...toast, id }];
	emit();
	setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
	return id;
}

/** Subscribes a component to the live toast list. */
export function useToasts(): ToastData[] {
	const [state, setState] = useState(toasts);
	useEffect(() => {
		const listener = () => setState(toasts);
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}, []);
	return state;
}

/** Fixed bottom-right stack. Mount once near the app root. */
export function ToastStack() {
	const items = useToasts();

	// Every HMR update (a file changed on disk and Vite pushed a new module)
	// surfaces as a toast, so the reader knows what just reloaded.
	useEffect(() => {
		if (!import.meta.hot) return;
		const handleAfterUpdate = (payload: { updates: Array<{ path: string }> }) => {
			const path = payload.updates[0]?.path;
			const name = path ? path.split("/").pop() : undefined;
			pushToast({ title: "Reloaded", message: name });
		};
		import.meta.hot.on("vite:afterUpdate", handleAfterUpdate);
		return () => {
			import.meta.hot?.off?.("vite:afterUpdate", handleAfterUpdate);
		};
	}, []);

	return (
		<div className="fixed right-4 bottom-4 z-[var(--z-toast)] flex flex-col gap-2">
			<AnimatePresence>
				{items.map((toast) => (
					<Toast
						key={toast.id}
						tone={toast.tone}
						title={toast.title}
						message={toast.message}
						icon={toast.icon}
						onClose={() => dismissToast(toast.id)}
					/>
				))}
			</AnimatePresence>
		</div>
	);
}
