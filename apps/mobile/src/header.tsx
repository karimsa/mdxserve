import type { ComponentProps } from "react";
import { View } from "react-native";
import type { Stack } from "expo-router";
import { Wordmark } from "@mdxserve/ui/brand/Wordmark";

type StackOptions = Extract<NonNullable<ComponentProps<typeof Stack>["screenOptions"]>, object>;

/**
 * Stands in for the centred title so iOS does not draw the screen's `title` beside the
 * wordmark. It takes no room; VoiceOver still reads the title from it.
 */
function SilentTitle({ children }: { children: string }) {
	return <View accessible={true} accessibilityRole="header" accessibilityLabel={children} />;
}

/**
 * The header every tab's stack uses: the wordmark at the leading edge, after the back item
 * when there is one, drawn as a plain view (`hidesSharedBackground`, iOS 26 and later) so iOS
 * puts no glass bubble behind it, and no visible title. The back item has no title, so the
 * wordmark sits in the same place on every screen. Each screen still sets `title`, which the
 * back menu and VoiceOver read.
 */
export const WORDMARK_HEADER = {
	unstable_headerLeftItems: () => [
		{ type: "custom", element: <Wordmark />, hidesSharedBackground: true },
	],
	headerBackVisible: true,
	headerTitle: SilentTitle,
	headerBackButtonDisplayMode: "minimal",
} satisfies StackOptions;
