import NativeSegmentedControl, {
	type SegmentedControlProps,
} from "@react-native-segmented-control/segmented-control";
import { useCallback, useEffect, useRef, type ComponentType } from "react";
import { Pressable, ScrollView, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CommentThread } from "@mdxserve/client/comments/threads";
import { Text } from "@mdxserve/ui/primitives/Text";
import type { CommentActions } from "./data";
import type { CommentsModel } from "./model";
import { ThreadView } from "./ThreadView";

/** Enough room around a control for a 44 pt touch target. */
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };
const TABS = ["open", "resolved"] as const;

// The package types its component as a class mixed from React Native's own, which React 19's
// JSX types do not accept; it is the component its props describe.
const SegmentedControl = NativeSegmentedControl as unknown as ComponentType<SegmentedControlProps>;

/** The segmented control's width, in the sheet and in the column. */
export const STATUS_WIDTH = 240;

/** Open and Resolved, with their counts, as the system's segmented control. */
export function StatusControl({ model, width }: { model: CommentsModel; width?: number }) {
	const { grouped } = model;
	const open = grouped.open.length + grouped.detached.length;
	return (
		<SegmentedControl
			values={[`Open · ${open}`, `Resolved · ${grouped.resolved.length}`]}
			selectedIndex={TABS.indexOf(model.tab)}
			onChange={(event) => {
				const next = TABS[event.nativeEvent.selectedSegmentIndex];
				if (next) model.setTab(next);
			}}
			accessibilityLabel="Comment status"
			testID="comments-status"
			style={width === undefined ? { height: 32 } : { width, height: 32 }}
		/>
	);
}

/** What the list says when the shown tab has no threads: one quiet line, centred. */
function emptyLine(model: CommentsModel): string {
	const { grouped, tab } = model;
	const none = grouped.open.length + grouped.detached.length + grouped.resolved.length === 0;
	const kind = tab === "open" ? "open" : "resolved";
	return none ? `No ${kind} comments on this document.` : `No ${kind} comments.`;
}

type ListProps = {
	model: CommentsModel;
	/** The comment writes; null on a restricted server, which offers none (KA14). */
	actions: CommentActions | null;
	loading: boolean;
	/** Why the threads could not be read, when they could not. */
	failure: string | null;
	onRetry(): void;
	/** Drawn over the sheet's see-through material: the active thread's surface is translucent. */
	translucent?: boolean;
};

/**
 * A document's comment threads (in the Comments sheet, or the column beside a wide window's
 * document): open threads in document order, then the detached ones, or the resolved ones.
 * A thread opened from the document (a highlight, a row marker) is scrolled into view.
 */
export function CommentsList({
	model,
	actions,
	loading,
	failure,
	onRetry,
	translucent = false,
}: ListProps) {
	const writer = actions ? { model, actions } : null;
	const insets = useSafeAreaInsets();
	const { grouped, tab, activeId, focusRequest } = model;
	const shown = tab === "open" ? grouped.open : grouped.resolved;

	// Scrolled once per request, as soon as the list knows where the thread is.
	const listRef = useRef<ScrollViewInstance>(null);
	const offsets = useRef(new Map<string, number>());
	const scrolledFor = useRef(0);
	const scrollToRequest = useCallback(() => {
		if (!focusRequest || scrolledFor.current === focusRequest.count) return;
		const offset = offsets.current.get(focusRequest.id);
		if (offset === undefined) return;
		scrolledFor.current = focusRequest.count;
		listRef.current?.scrollTo({ y: offset, animated: true });
	}, [focusRequest]);
	useEffect(scrollToRequest, [scrollToRequest]);

	function renderThread(thread: CommentThread) {
		return (
			<View
				key={thread.id}
				className="border-t border-border-default"
				onLayout={(event) => {
					offsets.current.set(thread.id, event.nativeEvent.layout.y);
					scrollToRequest();
				}}
			>
				<ThreadView
					thread={thread}
					resolution={model.resolutions.get(thread.id)}
					active={thread.id === activeId}
					focus={thread.id === focusRequest?.id}
					onSelect={() => model.selectThread(thread.id)}
					writer={writer}
					translucent={translucent}
				/>
			</View>
		);
	}

	let body;
	if (failure !== null) {
		body = (
			<View role="alert" className="items-center gap-2 px-6 py-4">
				<Text weight="semibold">Comments could not be loaded.</Text>
				<Text size="sm" tone="muted" className="text-center">
					{failure}
				</Text>
				<Pressable
					role="button"
					onPress={onRetry}
					hitSlop={HIT_SLOP}
					className="rounded-full bg-surface-accent-soft px-4 py-1.5"
				>
					<Text size="sm" weight="semibold" tone="accent">
						Retry
					</Text>
				</Pressable>
			</View>
		);
	} else if (loading) {
		body = (
			<Text tone="muted" className="px-6 py-4 text-center">
				Loading comments…
			</Text>
		);
	} else {
		const empty =
			tab === "open" ? grouped.open.length + grouped.detached.length === 0 : shown.length === 0;
		body = (
			<>
				{shown.map(renderThread)}
				{/* Every thread is a child of the list's content, so its layout's y is its offset. */}
				{tab === "open" && grouped.detached.length > 0 ? (
					<Text
						size="xs"
						weight="semibold"
						tone="subtle"
						className="border-t border-border-default px-4 pt-3.5 pb-1 uppercase"
					>
						Detached
					</Text>
				) : null}
				{tab === "open" ? grouped.detached.map(renderThread) : null}
				{empty ? (
					<Text tone="muted" className="px-6 py-3 text-center">
						{emptyLine(model)}
					</Text>
				) : null}
			</>
		);
	}

	return (
		<ScrollView
			ref={listRef}
			// Send, Save and Cancel take the tap while the keyboard is up, instead of only closing it.
			keyboardShouldPersistTaps="handled"
			contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
			testID="comments-list"
		>
			{body}
		</ScrollView>
	);
}

/**
 * The comments beside the document in a wide window (600 pt and over): the same control,
 * centred, and list as the sheet, in a column on the trailing side. The document's Comments
 * item opens and closes it.
 */
export function CommentsColumn(props: ListProps) {
	const insets = useSafeAreaInsets();
	return (
		<View
			testID="comments-panel"
			className="border-l border-border-default bg-surface-page"
			style={{ flex: 1, paddingRight: insets.right }}
		>
			<View className="items-center px-4 py-3">
				<StatusControl model={props.model} width={STATUS_WIDTH} />
			</View>
			<CommentsList {...props} />
		</View>
	);
}
