import { useState, type ReactNode } from "react";
import { Image, Text } from "react-native";
import { Icon } from "../primitives/Icon";
import { Pressable } from "../primitives/Pressable";

/**
 * The screenshot at the frame's full width, as tall as its aspect ratio makes it: React Native
 * sizes an image only once it knows its dimensions, which arrive when it loads. The whole image
 * is a button that opens the full-screen view; VoiceOver reads it as `name`.
 */
export function ScreenshotImage({
	src,
	alt,
	name,
	onPress,
}: {
	src: string;
	alt: string;
	name: string;
	onPress(): void;
}) {
	const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);
	return (
		<Pressable accessibilityLabel={`${name}. Opens full screen`} onPress={onPress}>
			<Image
				source={{ uri: src }}
				alt={alt}
				accessibilityLabel={alt}
				resizeMode="contain"
				onLoad={(event) => {
					const { width, height } = event.nativeEvent.source;
					if (width > 0 && height > 0) setAspectRatio(width / height);
				}}
				className="w-full"
				style={{ aspectRatio: aspectRatio ?? 16 / 10 }}
			/>
		</Pressable>
	);
}

export function ScreenshotCaption({ children }: { children: ReactNode }) {
	return (
		<Text className="border-t border-border-subtle px-4 py-2.5 font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-subtle">
			{children}
		</Text>
	);
}

/** The title bar's control that opens the full-screen view. */
export function ExpandButton({ onPress }: { onPress(): void }) {
	return (
		<Pressable
			aria-label="Expand screenshot"
			onPress={onPress}
			className="-mr-1 ml-auto h-[26px] w-[26px] items-center justify-center rounded-md border border-transparent"
		>
			<Icon name="expand" size="sm" className="text-text-muted" />
		</Pressable>
	);
}
