import { useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import type { DocumentTree } from "@mdxserve/client/document/tree-types";
import { TaskBox } from "@mdxserve/ui/document/elements";
import type { ListItemNode } from "@mdxserve/ui/document/environment";
import { useServerClient } from "../servers/server-query";
import type { KnownServer } from "../servers/store";
import { setTaskInSource, taskPlaces } from "./tasks";

interface TaskBoxState {
	checked: boolean;
	onToggle?: () => void;
	disabled: boolean;
}

interface TaskToggles {
	boxFor(item: ListItemNode): TaskBoxState;
}

const TaskTogglesContext = createContext<TaskToggles | null>(null);

export const TaskTogglesProvider = TaskTogglesContext.Provider;

/** A task item's box in the document screen: what the file says, or the tick being saved. */
export function DocumentTaskBox({ item }: { item: ListItemNode }) {
	const toggles = use(TaskTogglesContext);
	const box = toggles?.boxFor(item) ?? { checked: item.checked === true, disabled: false };
	return <TaskBox checked={box.checked} onToggle={box.onToggle} disabled={box.disabled} />;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Ticking task boxes (R7). A tick shows at once and is written with the procedures the web's
 * section editor uses: `getNodeSource` for the lines of the section that holds the box, the one
 * character changed, and `saveDocNode` with the version the document was read at, so a file
 * that changed since is refused rather than overwritten. A failure puts the box back and says
 * why. One tick is saved at a time; the others wait, disabled, until the document has reloaded.
 * A restricted server refuses every write, so there the boxes only show what the file says.
 */
export function useTaskToggles({
	server,
	path,
	document,
	version,
}: {
	server: KnownServer;
	path: string;
	document: DocumentTree | undefined;
	version: string | undefined;
}): TaskToggles {
	const queryClient = useQueryClient();
	const clientOf = useServerClient();
	const places = useMemo(() => (document ? taskPlaces(document) : null), [document]);
	const [pending, setPending] = useState<{ item: ListItemNode; checked: boolean } | null>(null);
	// A new document (the save's own reload, or a change on disk) shows what the file now says.
	const [shownDocument, setShownDocument] = useState(document);
	if (shownDocument !== document) {
		setShownDocument(document);
		setPending(null);
	}
	const busy = useRef(false);
	const readOnly = server.permissions === "restricted";

	const toggle = useCallback(
		async (item: ListItemNode) => {
			const place = places?.get(item);
			if (!place || version === undefined || busy.current) return;
			busy.current = true;
			const checked = item.checked !== true;
			setPending({ item, checked });
			const documentKey = [server.id, "getDocument", { path }];
			try {
				const client = await clientOf(server);
				const source = await client.getNodeSource.query({ path, id: place.ownerId });
				if (source.version !== version) {
					throw new Error("The file changed on the server. The new version is shown; try again.");
				}
				const edit = setTaskInSource(source.markdown, place, checked);
				if (edit.kind !== "ok") {
					throw new Error("This checkbox could not be found in the file, so it was left as it is.");
				}
				await client.saveDocNode.mutate({
					path,
					id: place.ownerId,
					version,
					markdown: edit.markdown,
				});
				await queryClient.invalidateQueries({ queryKey: documentKey });
			} catch (error) {
				setPending(null);
				Alert.alert("The checkbox was not changed", messageOf(error));
				void queryClient.invalidateQueries({ queryKey: documentKey });
			} finally {
				busy.current = false;
			}
		},
		[places, version, server, path, clientOf, queryClient],
	);

	return useMemo(
		() => ({
			boxFor(item) {
				const shown = pending?.item === item ? pending.checked : item.checked === true;
				if (readOnly || !places?.has(item)) return { checked: shown, disabled: false };
				return { checked: shown, onToggle: () => void toggle(item), disabled: pending !== null };
			},
		}),
		[pending, readOnly, places, toggle],
	);
}
