import { useMemo, type ComponentProps } from "react";
import { View } from "react-native";
import type { Stack } from "expo-router";
import { useUniwind } from "uniwind";
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
const WORDMARK_HEADER = {
	unstable_headerLeftItems: () => [
		{ type: "custom", element: <Wordmark />, hidesSharedBackground: true },
	],
	headerBackVisible: true,
	headerTitle: SilentTitle,
	headerBackButtonDisplayMode: "minimal",
} satisfies StackOptions;

/**
 * `WORDMARK_HEADER` on a translucent bar: content scrolls under it and shows through blurred by
 * the system's thin material, in the app's light or dark theme, so the wordmark and the trailing
 * items stay legible over text. The bar's own colour must be fully transparent: with any other
 * colour, react-native-screens builds an opaque bar appearance (`configureWithOpaqueBackground`)
 * and the bar draws solid. The header is transparent on every iOS version, not only iOS 26's
 * default, so content starts below the bar the same way everywhere: scroll views inset themselves
 * under it (`contentInsetAdjustmentBehavior="automatic"`). iOS 26's own scroll edge effect at the
 * top is off, since the blur does its job and the two would stack.
 */
export function useWordmarkHeader() {
	const dark = useUniwind().theme === "dark";
	return useMemo(
		() =>
			({
				...WORDMARK_HEADER,
				headerTransparent: true,
				headerBlurEffect: dark ? "systemThinMaterialDark" : "systemThinMaterialLight",
				headerStyle: { backgroundColor: "transparent" },
				scrollEdgeEffects: { top: "hidden" },
			}) satisfies StackOptions,
		[dark],
	);
}
