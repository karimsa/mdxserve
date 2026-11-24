import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { useAtom } from "jotai";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { CtlButton } from "./CtlButton";
import { DraftThread } from "./DraftThread";
import { threadAtPoint } from "./highlights";
import type { CommentsModel } from "./model";
import { draftAtom } from "./state";
import { Thread } from "./Thread";

const GAP = 8;
const EDGE = 16;

/** Where the popover hangs: the thread's range when it has one, else its block. */
function useReference(range: Range | null, element: Element | null) {
	return useMemo(() => {
		if (!range && !element) return null;
		return {
			getBoundingClientRect: () =>
				range?.getBoundingClientRect() ?? element?.getBoundingClientRect() ?? new DOMRect(),
			getClientRects: () => (range ? range.getClientRects() : element?.getClientRects()) ?? [],
			contextElement: element ?? undefined,
		};
	}, [range, element]);
}

/**
 * A 360px card under the highlight with the thread's timeline. Placed with
 * floating-ui against the range, and follows scroll and resize. Escape or a
 * click outside closes it.
 */
function PopoverFrame({
	reference,
	onClose,
	keepOpen,
	focusFrame,
	label,
	tools,
	children,
}: {
	reference: ReturnType<typeof useReference>;
	onClose: () => void;
	/** An outside click leaves it open (a draft with text in it). */
	keepOpen: boolean;
	focusFrame: boolean;
	label: string;
	tools: ReactNode;
	children: ReactNode;
}) {
	const frameRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const floating = frameRef.current;
		if (!reference || !floating) return;
		return autoUpdate(reference, floating, () => {
			void computePosition(reference, floating, {
				strategy: "fixed",
				placement: "bottom-start",
				middleware: [offset(GAP), flip({ padding: EDGE }), shift({ padding: EDGE })],
			}).then(({ x, y }) => {
				floating.style.left = `${x}px`;
				floating.style.top = `${y}px`;
				floating.style.visibility = "visible";
			});
		});
	}, [reference]);

	useEffect(() => {
		if (focusFrame) frameRef.current?.focus({ preventScroll: true });
	}, [focusFrame]);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape" && !event.defaultPrevented) onClose();
		}
		function onPointerDown(event: PointerEvent) {
			const target = event.target instanceof Element ? event.target : null;
			if (!target || frameRef.current?.contains(target)) return;
			if (keepOpen || target.closest("[data-comments-keep]")) return;
			// A click on another highlight is handled there: it swaps the thread.
			if (threadAtPoint(event.clientX, event.clientY)) return;
			onClose();
		}
		window.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [onClose, keepOpen]);

	return (
		<div
			ref={frameRef}
			role="dialog"
			aria-label={label}
			tabIndex={-1}
			data-print-hide
			style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
			className="z-[var(--z-dropdown)] w-[360px] max-w-[calc(100vw-32px)] rounded-xl border border-border-default bg-surface-card shadow-lg outline-0"
		>
			<span className="absolute top-2 right-2 z-[1] flex">{tools}</span>
			<div className="max-h-[min(70vh,560px)] overflow-y-auto p-3.5 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin]">
				{children}
			</div>
		</div>
	);
}

/**
 * The popover for desktop with the sidebar closed: an existing thread (opened
 * from a highlight or a gutter counter) or a new comment's composer. A new
 * comment opens it whether or not the sidebar is open.
 */
export function CommentsPopover({
	model,
	sidebarOpen,
}: {
	model: CommentsModel;
	sidebarOpen: boolean;
}) {
	const [draft, setDraft] = useAtom(draftAtom);
	const thread = draft ? undefined : model.threads.find((entry) => entry.id === model.popoverId);
	const view = thread ? model.views.get(thread.id) : undefined;
	const reference = useReference(
		draft ? draft.range : (view?.range ?? null),
		draft ? null : (view?.scrollTarget ?? null),
	);

	const close = model.closePopover;
	const discardDraft = () => setDraft(null);
	const writing = draft !== null && draft.body.trim() !== "";
	// Read when a request finishes, so a newer popover is not dismissed by an older resolve.
	const shownId = useRef(model.popoverId);
	shownId.current = model.popoverId;

	if (draft) {
		return (
			<PopoverFrame
				reference={reference}
				onClose={discardDraft}
				keepOpen={writing}
				focusFrame={false}
				label="New comment"
				tools={<CtlButton icon="x" label="Discard comment" onClick={discardDraft} />}
			>
				<DraftThread model={model} sidebarOpen={sidebarOpen} reserveTools padded={false} />
			</PopoverFrame>
		);
	}
	if (!thread || thread.resolved) return null;

	return (
		<PopoverFrame
			key={thread.id}
			reference={reference}
			onClose={close}
			keepOpen={false}
			focusFrame
			label="Comment thread"
			tools={
				<>
					{model.readOnly ? null : (
						<CtlButton
							tone="resolve"
							icon="check"
							label="Resolve thread"
							disabled={model.writesDisabled}
							onClick={() => {
								void model.actions.setResolved(thread.id, true).then((saved) => {
									if (saved && shownId.current === thread.id) close();
								});
							}}
						/>
					)}
					<CtlButton
						icon="panel-right"
						label="Open in sidebar"
						onClick={() => model.openInSidebar(thread.id)}
					/>
					<CtlButton icon="x" label="Close" onClick={close} />
				</>
			}
		>
			<Thread
				key={`${model.path}:${thread.id}`}
				thread={thread}
				view={view}
				active
				variant="popover"
				model={model}
			/>
		</PopoverFrame>
	);
}
