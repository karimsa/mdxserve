import { Image, Modal, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Pressable } from "../primitives/Pressable";
import type { ExpandedScreenshot } from "./Screenshot";

/**
 * The app's full-screen screenshot: a page sheet with the image fitted to it, pinch to zoom
 * (up to 8×) and drag to pan, and Done (or a swipe down) to close.
 */
export function ScreenshotViewer({ open, onClose, src, alt, title }: ExpandedScreenshot) {
	const window = useWindowDimensions();
	return (
		<Modal
			visible={open}
			presentationStyle="pageSheet"
			animationType="slide"
			onRequestClose={onClose}
		>
			<View className="flex-1 bg-surface-sunken">
				<View className="h-12 flex-row items-center border-b border-border-subtle bg-surface-raised px-4">
					<Text
						numberOfLines={1}
						className="flex-1 font-sans font-semibold leading-normal text-[length:var(--size-sm)] text-text-heading"
					>
						{title || alt || "Screenshot"}
					</Text>
					<Pressable onPress={onClose} className="h-8 justify-center px-2">
						<Text className="font-sans font-semibold leading-normal text-[length:var(--size-md)] text-text-accent">
							Done
						</Text>
					</Pressable>
				</View>
				<ScrollView
					maximumZoomScale={8}
					minimumZoomScale={1}
					centerContent={true}
					showsHorizontalScrollIndicator={false}
					showsVerticalScrollIndicator={false}
					contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}
				>
					<Image
						source={{ uri: src }}
						accessibilityLabel={alt}
						resizeMode="contain"
						style={{ width: window.width, height: window.height - 96 }}
					/>
				</ScrollView>
			</View>
		</Modal>
	);
}
