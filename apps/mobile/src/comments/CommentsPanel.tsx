import { useCallback, useEffect, useRef } from "react";
import { Pressable, ScrollView, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CommentThread } from "@mdxserve/client/comments/threads";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Text } from "@mdxserve/ui/primitives/Text";
import type { CommentsModel } from "./model";
import { ThreadView } from "./ThreadView";

/** Enough room around a header control for a 44 pt touch target. */
const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

function Tabs({ model }: { model: CommentsModel }) {
	const { grouped } = model;
	const entries = [
		{ value: "open", label: "Open", count: grouped.open.length + grouped.detached.length },
		{ value: "resolved", label: "Resolved", count: grouped.resolved.length },
	] as const;
	return (
		<View role="tablist" accessibilityLabel="Comment status" className="flex-row gap-4">
			{entries.map((entry) => {
				const selected = model.tab === entry.value;
				return (
					<Pressable
						key={entry.value}
						role="tab"
						aria-selected={selected}
						accessibilityLabel={`${entry.label} ${entry.count}`}
						onPress={() => model.setTab(entry.value)}
						hitSlop={HIT_SLOP}
						className={`flex-row items-center gap-1.5 border-b-2 py-2 ${selected ? "border-text-heading" : "border-transparent"}`}
					>
						<Text size="sm" weight="semibold" tone={selected ? "heading" : "subtle"}>
							{entry.label}
						</Text>
						<Text size="sm" weight="medium" tone="subtle">
							{String(entry.count)}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

/**
 * The document's comment threads, docked in the document screen: under the document in a
 * narrow window and beside it in a wide one (`placement`), never over it, so the text a thread
 * is about stays on screen and its highlights stay tappable. Open threads are listed in document
 * order, then the detached ones; resolved threads have their own tab. It reads and moves the
 * document; writing comments comes later.
 */
export function CommentsPanel({
	model,
	placement,
	loading,
	failure,
	onRetry,
}: {
	model: CommentsModel;
	placement: "below" | "beside";
	loading: boolean;
	/** Why the threads could not be read, when they could not. */
	failure: string | null;
	onRetry(): void;
}) {
	const insets = useSafeAreaInsets();
	const below = placement === "below";
	// The rows keep 16 pt from the panel's edges; the panel keeps clear of whatever the system
	// draws at the window's sides (a folded display's vertical bar). Beside the document it is
	// the trailing column, so only its trailing edge meets the window.
	const padding = {
		paddingLeft: below ? insets.left : 0,
		paddingRight: insets.right,
	};
	const { grouped, tab, activeId, focusRequest } = model;
	const shown = tab === "open" ? grouped.open : grouped.resolved;

	// A thread opened from the document (a highlight, a row marker) is scrolled into view, once
	// per request, as soon as the panel knows where it is.
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
				className="border-b border-border-default"
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
				/>
			</View>
		);
	}

	let body;
	if (failure !== null) {
		body = (
			<View role="alert" className="gap-2 px-4 py-4">
				<Text size="sm" weight="semibold">
					Comments could not be loaded.
				</Text>
				<Text size="sm" tone="muted">
					{failure}
				</Text>
				<Pressable
					role="button"
					onPress={onRetry}
					hitSlop={HIT_SLOP}
					className="self-start rounded-md border border-border-default px-3 py-1.5"
				>
					<Text size="sm" weight="semibold">
						Retry
					</Text>
				</Pressable>
			</View>
		);
	} else if (loading) {
		body = (
			<Text size="sm" tone="subtle" className="px-4 py-4">
				Loading comments…
			</Text>
		);
	} else {
		body = (
			<>
				{shown.map(renderThread)}
				{/* Every thread is a child of the list's content, so its layout's y is its offset. */}
				{tab === "open" && grouped.detached.length > 0 ? (
					<Text size="xs" weight="semibold" tone="subtle" className="px-4 pt-3.5 uppercase">
						Detached
					</Text>
				) : null}
				{tab === "open" ? grouped.detached.map(renderThread) : null}
				{tab === "open" && grouped.open.length === 0 && grouped.detached.length === 0 ? (
					<Text size="sm" tone="subtle" className="px-4 py-4">
						No open comments.
					</Text>
				) : null}
				{tab === "resolved" && grouped.resolved.length === 0 ? (
					<Text size="sm" tone="subtle" className="px-4 py-4">
						No resolved comments.
					</Text>
				) : null}
			</>
		);
	}

	return (
		<View
			testID="comments-panel"
			className={`bg-surface-page ${below ? "border-t" : "border-l"} border-border-default`}
			style={{ flex: 1, paddingLeft: padding.paddingLeft, paddingRight: padding.paddingRight }}
		>
			<View className="flex-row items-center gap-3 border-b border-border-default pl-4">
				<Tabs model={model} />
				<View className="flex-1" />
				{below ? (
					<Pressable
						role="button"
						accessibilityLabel={model.expanded ? "Show the document" : "Expand comments"}
						onPress={() => model.setExpanded(!model.expanded)}
						hitSlop={HIT_SLOP}
						className="h-9 w-9 items-center justify-center"
					>
						<Icon
							name={model.expanded ? "chevron-down" : "chevron-up"}
							size="md"
							className="text-text-muted"
						/>
					</Pressable>
				) : null}
				<Pressable
					role="button"
					accessibilityLabel="Close comments"
					onPress={() => model.setOpen(false)}
					hitSlop={HIT_SLOP}
					className="h-9 w-9 items-center justify-center"
				>
					<Icon name="x" size="md" className="text-text-muted" />
				</Pressable>
			</View>
			<ScrollView
				ref={listRef}
				contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
				testID="comments-list"
			>
				{body}
			</ScrollView>
		</View>
	);
}
