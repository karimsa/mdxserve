import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ImageView } from "@mdxserve/ui/document/environment";

/** How tall an image's box is until the image says its own size. */
const LOADING_HEIGHT = 160;

/**
 * A document's image through expo-image (cached on the device). Until it loads it holds a box
 * the width of the text; then it takes its own size, never wider than the text, at its aspect
 * ratio. One that cannot load says so in a quiet line, with its alt text. VoiceOver reads the
 * alt text as the image's label.
 */
export function DocumentImage({ src, alt }: ImageView) {
	const [size, setSize] = useState<{ width: number; height: number } | null>(null);
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	if (failedSrc === src) {
		return (
			<Text className="font-sans text-[length:var(--size-sm)] text-text-subtle" role="img">
				{alt === "" ? "Image could not be loaded" : `Image could not be loaded: ${alt}`}
			</Text>
		);
	}
	const style =
		size && size.width > 0 && size.height > 0
			? { width: size.width, maxWidth: "100%" as const, aspectRatio: size.width / size.height }
			: styles.loading;
	return (
		<View className="my-2 w-full">
			<Image
				source={{ uri: src }}
				alt={alt}
				accessible={true}
				accessibilityLabel={alt}
				contentFit="contain"
				transition={0}
				onLoad={(event) => setSize({ width: event.source.width, height: event.source.height })}
				onError={() => setFailedSrc(src)}
				style={[styles.image, style]}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	image: { borderRadius: 6 },
	loading: { width: "100%", height: LOADING_HEIGHT },
});
