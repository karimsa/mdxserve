import { useSyncExternalStore } from "react";
import { Pressable } from "react-native";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Text } from "@mdxserve/ui/primitives/Text";
import type { CommentsStore } from "./model";

const SIZE = 20;
/** Enough room around the marker for a 44 pt touch target. */
const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

/**
 * A list row's comment marker: a small round button at the row's top trailing corner, over the
 * list's side padding, when the row holds open threads, with their number when there are more
 * than one. It opens the row's first thread, and it is how VoiceOver reaches a thread (KA17),
 * since a highlight inside a line of text is not an element of its own.
 */
export function RowMarker({ store, row }: { store: CommentsStore; row: number }) {
	const ids = useSyncExternalStore(store.subscribe, () => store.rowThreads(row));
	if (!ids || ids.length === 0) return null;
	const count = ids.length;
	return (
		<Pressable
			role="button"
			accessibilityLabel={count === 1 ? "1 comment" : `${count} comments`}
			onPress={() => store.pressRow(row)}
			hitSlop={HIT_SLOP}
			testID={`row-marker-${row}`}
			style={{ position: "absolute", top: 4, right: -(SIZE - 6), minWidth: SIZE, height: SIZE }}
			className="items-center justify-center rounded-full bg-comment-mark-active px-1"
		>
			{count > 1 ? (
				<Text size="xs" weight="bold" tone="heading">
					{String(count)}
				</Text>
			) : (
				<Icon name="message-square" size={11} className="text-text-heading" />
			)}
		</Pressable>
	);
}
