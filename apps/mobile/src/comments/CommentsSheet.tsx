import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Text } from "@mdxserve/ui/primitives/Text";
import { CommentsList, STATUS_WIDTH, StatusControl } from "./CommentsPanel";
import { useCommentsView, useCommentsViews } from "./sheet";

function close() {
	if (router.canGoBack()) router.back();
}

/**
 * The open document's comments (app/comments.tsx), in a sheet the native stack presents with
 * the system grabber and detents and no navigation bar (app/_layout.tsx): under the grabber,
 * the Open and Resolved control, centred, then the threads. It closes the way a sheet does, by
 * a swipe down, or VoiceOver's escape gesture. The document stays usable behind it up to half
 * height, and choosing a highlight or a row marker there selects that thread here. With Liquid
 * Glass (iOS 26 and later) nothing opaque is painted over the sheet, so the system's
 * see-through material shows; before it, the sheet is in the page colour. The sheet has a
 * safe area provider of its own, as the Contents sheet does, so its insets are the sheet's.
 */
export function CommentsSheet({ viewKey }: { viewKey: string }) {
	const views = useCommentsViews();
	const view = useCommentsView(viewKey);
	// When the sheet goes (swiped down or closed), its document stops showing it as open.
	const latest = useRef(view);
	latest.current = view;
	useEffect(
		() => () => {
			latest.current?.onClosed();
			views.close(viewKey);
		},
		[views, viewKey],
	);
	const glass = isLiquidGlassAvailable();
	return (
		<SafeAreaProvider>
			<View
				accessibilityLabel="Comments"
				onAccessibilityEscape={close}
				className={glass ? "flex-1" : "flex-1 bg-surface-page"}
				testID="comments-sheet"
			>
				{view ? (
					<>
						{/* Clear of the grabber, centred in the sheet's width. */}
						<View className="items-center px-4 pt-5 pb-3">
							<StatusControl model={view.model} width={STATUS_WIDTH} />
						</View>
						<CommentsList
							model={view.model}
							actions={view.actions}
							loading={view.loading}
							failure={view.failure}
							onRetry={view.onRetry}
							translucent={glass}
						/>
					</>
				) : (
					<Text tone="muted" className="px-6 pt-6 pb-4 text-center">
						This document is no longer open.
					</Text>
				)}
			</View>
		</SafeAreaProvider>
	);
}
