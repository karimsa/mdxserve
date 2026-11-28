import { useState } from "react";
import { View } from "react-native";
import { Text } from "@mdxserve/ui/primitives/Text";
import { CommentField } from "./CommentField";
import type { CommentActions } from "./data";
import type { CommentsModel, Draft } from "./model";

/** The writes in flight are held by key; a new thread's is this one. */
const DRAFT_KEY = "draft";

/**
 * A new thread on the text the reader selected (KB1): the quote in the highlight's colour, then
 * the comment's field with Cancel and Send. A failed send keeps the text and shows why (KA13);
 * a sent one becomes the active thread.
 */
export function DraftComposer({
	draft,
	model,
	actions,
	translucent,
}: {
	draft: Draft;
	model: CommentsModel;
	actions: CommentActions;
	translucent: boolean;
}) {
	const [error, setError] = useState<string | null>(null);

	async function send() {
		const { anchor, body } = draft;
		const result = await model.send(DRAFT_KEY, () => actions.addThread(anchor, body));
		if (!result) return;
		if (result.kind === "failed") {
			setError(result.message);
			return;
		}
		setError(null);
		model.finishDraft(result.threadId);
	}

	return (
		<View
			role="group"
			accessibilityLabel={`New comment on: ${draft.anchor.quote}`}
			testID="comment-draft"
			className={`gap-3 px-4 pt-3.5 pb-4 ${translucent ? "bg-surface-card/50" : "bg-surface-card"}`}
		>
			<Text size="sm" numberOfLines={3} className="text-text-heading">
				<Text size="sm" className="bg-comment-mark-active">
					{draft.anchor.quote}
				</Text>
			</Text>
			<CommentField
				label="Comment"
				sendLabel="Send comment"
				placeholder="Add a comment…"
				value={draft.body}
				onChange={model.setDraftBody}
				onSubmit={() => void send()}
				onCancel={() => {
					setError(null);
					model.cancelDraft();
				}}
				pending={model.pending.has(DRAFT_KEY)}
				error={error}
				autoFocus={true}
			/>
		</View>
	);
}
