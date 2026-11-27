import type { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";

/**
 * Give the editor keyboard focus, with the cursor moved to the start of the document for
 * `"start"`.
 *
 * Use this in place of Tiptap's `focus` command (`editor.commands.focus()` and
 * `.chain().focus()`). On iOS, and on Safari, that command focuses the DOM node while its
 * own transaction is still waiting to be dispatched. Focusing makes the view dispatch first,
 * so the waiting transaction then applies to a document it was not built from, and
 * ProseMirror throws "Applying a mismatched transaction". Here nothing is waiting: the
 * selection is dispatched, then the view is focused.
 */
export function focusEditor(editor: Editor, at?: "start"): void {
	if (editor.isDestroyed) return;
	const { view } = editor;
	if (at === "start") {
		view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)).scrollIntoView());
	}
	view.focus();
}
