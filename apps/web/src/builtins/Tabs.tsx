import { useContext } from "react";
import { useAtomValue } from "jotai";
import SharedTabs, { type TabsEntry } from "@mdxserve/ui/builtins/Tabs";
import { DocContext } from "@mdxserve/ui/document/DocContext";
import { selectTabs, tabSelectionAtom, tabSelectionKey } from "../document/tabs-state";
import type { TabProps } from "@mdxserve/shared/builtins/tabs";

/**
 * Never rendered: the document tree turns each `<Tab>` into an entry of its
 * `Tabs` node. It stays in the builtin list so `mdxserve components` and the
 * editor's templates describe it.
 */
export function Tab(_props: TabProps) {
	return null;
}

interface TabsViewProps {
	id: string;
	defaultValue: string;
	tabs: readonly TabsEntry[];
}

/**
 * The shared `Tabs` (@mdxserve/ui) with the web client's selection: it lives in
 * `tabSelectionAtom` under the document path and this `Tabs`'s id, so it
 * survives the document changing on disk and `revealNode` can set it.
 */
export default function Tabs({ id, defaultValue, tabs }: TabsViewProps) {
	const documentPath = useContext(DocContext)?.path ?? "";
	const chosen = useAtomValue(tabSelectionAtom)[tabSelectionKey(documentPath, id)];
	const selected =
		tabs.find((tab) => tab.value === chosen)?.value ??
		tabs.find((tab) => tab.value === defaultValue)?.value ??
		tabs[0]?.value ??
		"";

	return (
		<SharedTabs
			id={id}
			tabs={tabs}
			selected={selected}
			onSelect={(value) => selectTabs(documentPath, [{ tabsId: id, value }])}
		/>
	);
}
