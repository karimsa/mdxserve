import { useAtom, useSetAtom, useStore } from "jotai";
import type { CommentsModel } from "./model";
import { ReplyField } from "./ReplyField";
import {
	activeThreadAtom,
	draftAtom,
	pendingSendsAtom,
	popoverThreadAtom,
	withPendingSend,
} from "./state";
import { Avatar, QuoteText } from "./Thread";

/** The new-comment composer: the selected quote and an empty field, in the popover or the sheet. */
export function DraftThread({
	model,
	sidebarOpen,
	reserveTools,
	padded,
}: {
	model: CommentsModel;
	sidebarOpen: boolean;
	/** Leaves room for the popover's tool buttons beside the quote. */
	reserveTools: boolean;
	padded: boolean;
}) {
	const [draft, setDraft] = useAtom(draftAtom);
	const setActive = useSetAtom(activeThreadAtom);
	const setPopover = useSetAtom(popoverThreadAtom);
	// Shared, so a composer that remounts mid-save (the sheet closed and reopened)
	// still shows its send as pending and cannot post the comment twice.
	const [pendingSends, setPendingSends] = useAtom(pendingSendsAtom);
	const pendingKey = draft ? `draft:${draft.nonce}` : "";
	const pending = pendingSends.has(pendingKey);
	const setPending = (active: boolean) =>
		setPendingSends((previous) => withPendingSend(previous, pendingKey, active));
	const store = useStore();
	if (!draft) return null;

	async function submit() {
		if (!draft) return;
		// This draft, by the press that opened it: a later one must survive our completion.
		const submitted = draft.nonce;
		setPending(true);
		const created = await model.actions.addThread(draft.anchor, draft.body);
		setPending(false);
		// On failure the draft, with its text, stays.
		if (created === null) return;
		// The user moved on to another comment (or another doc) while this one saved.
		if (store.get(draftAtom)?.nonce !== submitted) return;
		setDraft(null);
		setActive(created);
		// The popover follows the new thread unless the sidebar shows it.
		if (!sidebarOpen) setPopover(created);
	}

	return (
		<div
			data-draft
			className={"flex flex-col gap-3 " + (padded ? "pt-4 pr-3.5 pb-[18px] pl-4" : "")}
		>
			<div className={reserveTools ? "pr-[84px]" : ""}>
				<QuoteText text={draft.anchor.quote} active />
			</div>
			<div className="grid grid-cols-[24px_1fr] items-end gap-x-2.5">
				<Avatar author="human" />
				<ReplyField
					label="New comment"
					sendLabel="Send comment"
					placeholder={
						model.writesDisabled ? "Close the section editor to comment" : "Add a comment…"
					}
					value={draft.body}
					onChange={(body) => setDraft({ ...draft, body })}
					onSubmit={() => void submit()}
					onCancel={() => setDraft(null)}
					disabled={model.writesDisabled}
					pending={pending}
					focusNonce={draft.nonce}
				/>
			</div>
		</div>
	);
}
