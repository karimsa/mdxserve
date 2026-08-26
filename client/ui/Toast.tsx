import { useEffect, type CSSProperties, type ReactNode } from "react";
import {
	CheckmarkIcon,
	ErrorIcon,
	ToastBar,
	Toaster,
	toast,
	useToasterStore,
	type Toast as HotToast,
} from "react-hot-toast";
import { Icon } from "./Icon";
import { nextCount } from "./toast-count";
import { docModuleCache } from "../doc-module-cache";

export type ToastTone = "info" | "ok" | "warn" | "danger";

export interface ToastInput {
	tone: ToastTone;
	/** The whole toast — one line, sentence case, human-written. */
	text: string;
	/** Lucide icon name overriding the tone's icon (e.g. "download", "trash-2"). */
	icon?: string;
	/** Pushes sharing a key collapse into one card: repeat push = same card, ×N counter, bounce, dismiss timer restarted. */
	dedupeKey?: string;
}

const TONE_FG: Record<ToastTone, string> = {
	info: "text-status-info-fg",
	ok: "text-status-ok-fg",
	warn: "text-status-warn-fg",
	danger: "text-status-danger-fg",
};

// react-hot-toast only exposes live state through this hook, so the module
// scope below can't just read a store synchronously the way `pushToast` (a
// plain function, called from outside React) needs to. Instead a child
// component mirrors the hook's state into `liveIds` on every change; that
// mirror is what `nextCount` consults. Driving it off `visible` (not just
// presence in the list, which includes toasts mid fade-out) is what keeps
// counting correct under pause-on-hover: a hovered toast's dismiss timer is
// paused, not fired, so it stays "live" and a repeat push still increments
// its counter instead of resetting to 1.
let liveIds = new Set<string>();
const counts = new Map<string, number>();

function LiveIdMirror() {
	const { toasts } = useToasterStore();
	useEffect(() => {
		liveIds = new Set(toasts.filter((item) => item.visible).map((item) => item.id));
	}, [toasts]);
	return null;
}

/**
 * react-hot-toast sets each bar's enter/exit `animation` inline (see its
 * source), so a plain class on `ToastBar` itself would lose to that inline
 * style — or, with `!important`, would clobber the exit animation too. This
 * wrapper carries the attention-bounce class instead, one layer out from
 * where react-hot-toast writes its own animation.
 */
function Bump({ pulse, children }: { pulse: number; children: ReactNode }) {
	const bumpClass = pulse > 0 ? (pulse % 2 === 1 ? "toast-bump-a" : "toast-bump-b") : undefined;
	return <div className={bumpClass}>{children}</div>;
}

function toneIcon(tone: ToastTone, iconName: string | undefined) {
	if (iconName) return <Icon name={iconName} size="md" className={TONE_FG[tone]} />;
	switch (tone) {
		case "ok":
			return <CheckmarkIcon primary="var(--status-ok-fg)" secondary="var(--surface-raised)" />;
		case "danger":
			return <ErrorIcon primary="var(--status-danger-fg)" secondary="var(--surface-raised)" />;
		case "warn":
			return <Icon name="triangle-alert" size="md" className="text-status-warn-fg" />;
		case "info":
			return null;
	}
}

/**
 * Queues a toast; repeat pushes sharing `dedupeKey` collapse into the same
 * card (message updates, ×N counter, attention bounce, dismiss timer
 * restarted) instead of stacking a second one. Returns the toast's id.
 */
export function pushToast(input: ToastInput): string {
	const id = input.dedupeKey;
	const count = input.dedupeKey ? nextCount(liveIds, counts, input.dedupeKey) : 1;
	const message =
		count > 1 ? (
			<>
				{input.text}
				<span className="ml-2 rounded-pill border border-border-default bg-surface-sunken px-1.5 text-[11px] tabular-nums text-text-muted">
					×{count}
				</span>
			</>
		) : (
			input.text
		);
	const toastId = toast.custom(
		(liveToast: HotToast) => (
			<Bump pulse={count - 1}>
				<ToastBar toast={{ ...liveToast, message }} />
			</Bump>
		),
		{
			id,
			duration: 4000,
			// ToastBar picks its enter/exit direction from the toast, not the
			// Toaster; without this it animates as if the stack were top-center.
			position: "bottom-right",
			icon: toneIcon(input.tone, input.icon),
		},
	);
	// The mirror only catches up after React commits; mark the id live now so
	// a second push in the same tick still counts as a repeat.
	liveIds.add(toastId);
	return toastId;
}

/** Re-exported for symmetry with `pushToast`. */
export const dismissToast = toast.dismiss;

const TOAST_STYLE: CSSProperties = {
	background: "var(--surface-raised)",
	color: "var(--text-heading)",
	border: "1px solid var(--border-default)",
	borderRadius: 8,
	boxShadow: "var(--shadow-toast)",
	font: "500 14px/1.4 var(--font-sans)",
	maxWidth: 360,
};

/** Fixed bottom-right stack. Mount once near the app root. */
export function ToastStack() {
	// The server names the doc that was edited (`mdxserve:doc-changed`, sent
	// from its file watcher). Vite's own `vite:afterUpdate` can't be used for
	// this: a doc module has no HMR boundary, so the update is attributed to
	// the importer that accepted it (App.tsx), and the Tailwind rebuild the
	// edit triggers shows up as a second update for app.css.
	useEffect(() => {
		if (!import.meta.hot) return;
		// The event covers every doc under every mounted root, so keep only the
		// docs this tab has actually loaded (the old vite:afterUpdate toast was
		// scoped to loaded modules the same way) — an agent editing forty
		// unrelated files shouldn't rain toasts on a reader. Keyed by path so a
		// burst of saves to one doc refreshes a single card (counter + bounce,
		// timer restarted) instead of stacking copies.
		const handleDocChanged = (data: {
			files?: Array<{ path: string; root: string; rel: string }>;
		}) => {
			const files = (data?.files ?? []).filter((file) => docModuleCache.has(file.path));
			const [first] = files;
			if (!first) return;
			if (files.length === 1) {
				pushToast({
					tone: "info",
					text: `Reloaded ${first.rel}`,
					dedupeKey: `reload:${first.path}`,
				});
			} else {
				pushToast({
					tone: "info",
					text: `Reloaded ${files.length} docs`,
					dedupeKey: "reload:many",
				});
			}
		};
		import.meta.hot.on("mdxserve:doc-changed", handleDocChanged);
		return () => {
			import.meta.hot?.off?.("mdxserve:doc-changed", handleDocChanged);
		};
	}, []);

	return (
		<>
			<LiveIdMirror />
			{/* Inline style, not a class: goober (react-hot-toast's runtime CSS-in-JS)
			    injects the base toast class after this stylesheet loads, so only an
			    inline style is guaranteed to win. The custom properties still resolve
			    at computed-style time, so light/dark both come through correctly. */}
			<Toaster
				position="bottom-right"
				gutter={8}
				containerStyle={{ zIndex: "var(--z-toast)", inset: 16 }}
				toastOptions={{ duration: 4000, style: TOAST_STYLE }}
			/>
		</>
	);
}
