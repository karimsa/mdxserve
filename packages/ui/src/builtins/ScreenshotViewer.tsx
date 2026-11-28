import { useState } from "react";
import { Image, Modal, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "../primitives/Pressable";
import type { ExpandedScreenshot } from "./Screenshot";

/** The space the caption keeps from the sheet's edges, inside the safe area. */
const GUTTER = 16;

/**
 * The app's full-screen screenshot: a page sheet with the image fitted to it, pinch to zoom
 * (up to 8×) and drag to pan, and the caption (or the window's title) on a band at the bottom.
 * The image is sized from the area the sheet gives it, which on iPad is narrower than the
 * window.
 *
 * There is no Done button. A swipe down closes the sheet: on the grabber strip and the caption
 * band at any zoom, since neither is inside the zoomable area, and on the image once it is
 * at its top edge. The grabber is also a button, and VoiceOver's escape gesture closes it.
 */
export function ScreenshotViewer({ open, onClose, src, alt, title, caption }: ExpandedScreenshot) {
	const [area, setArea] = useState<{ width: number; height: number } | null>(null);
	const insets = useSafeAreaInsets();
	const label = caption || title;
	return (
		<Modal
			visible={open}
			presentationStyle="pageSheet"
			animationType="slide"
			allowSwipeDismissal={true}
			onRequestClose={onClose}
		>
			<View
				className="flex-1 bg-surface-sunken"
				accessibilityViewIsModal={true}
				onAccessibilityEscape={onClose}
			>
				<Pressable
					accessibilityLabel="Close full screen"
					onPress={onClose}
					className="h-6 items-center justify-center"
				>
					<View className="h-[5px] w-9 rounded-full bg-border-strong" />
				</Pressable>
				<ScrollView
					testID="screenshot-viewer-area"
					onLayout={(event) => {
						const { width, height } = event.nativeEvent.layout;
						setArea({ width, height });
					}}
					maximumZoomScale={8}
					minimumZoomScale={1}
					centerContent={true}
					showsHorizontalScrollIndicator={false}
					showsVerticalScrollIndicator={false}
					contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}
				>
					{area ? (
						<Image
							source={{ uri: src }}
							accessibilityLabel={alt}
							resizeMode="contain"
							style={{ width: area.width, height: area.height }}
						/>
					) : null}
				</ScrollView>
				{label ? (
					// At most 40% of the sheet, scrolling past that, so a long caption at a large
					// text size never leaves the image without room.
					<ScrollView
						testID="screenshot-viewer-caption"
						className="border-t border-border-subtle bg-surface-raised"
						style={{ flexGrow: 0, maxHeight: "40%" }}
						alwaysBounceVertical={false}
						contentContainerStyle={{
							paddingTop: 12,
							paddingLeft: GUTTER + insets.left,
							paddingRight: GUTTER + insets.right,
							paddingBottom: 12 + insets.bottom,
						}}
					>
						<Text className="font-sans font-medium leading-normal text-[length:var(--size-sm)] text-text-body">
							{label}
						</Text>
					</ScrollView>
				) : null}
			</View>
		</Modal>
	);
}
