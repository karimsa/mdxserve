import { useMemo, type ComponentProps } from "react";
import { View } from "react-native";
import type { Stack } from "expo-router";
import { useResolveClassNames, useUniwind } from "uniwind";
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

/** How much of the page colour tints the bar's blur: enough to read the bar's items over text. */
const BAR_TINT_ALPHA = 0.6;

/** `#rrggbb` with an alpha, as `rgba()`; any other colour as it is. */
function withAlpha(color: string, alpha: number): string {
	const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
	if (!hex) return color;
	const [red, green, blue] = hex.slice(1).map((part) => Number.parseInt(part, 16));
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * `WORDMARK_HEADER` on a translucent bar: content scrolls under it, blurred by the system's
 * chrome material (the navigation bar's own) in the app's light or dark theme and tinted with
 * the page colour (`--surface-page`), so the wordmark and the trailing items stay legible over
 * text. The header is transparent on every iOS version, not only iOS 26's default, so content
 * starts below the bar the same way everywhere: scroll views inset themselves under it
 * (`contentInsetAdjustmentBehavior="automatic"`). iOS 26's own scroll edge effect at the top is
 * off, since the blur does its job and the two would stack.
 */
export function useWordmarkHeader() {
	const { theme } = useUniwind();
	const { backgroundColor } = useResolveClassNames("bg-surface-page");
	const dark = theme === "dark";
	const page = typeof backgroundColor === "string" ? backgroundColor : dark ? "#030712" : "#fbfbf9";
	return useMemo(
		() =>
			({
				...WORDMARK_HEADER,
				headerTransparent: true,
				headerBlurEffect: dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight",
				headerStyle: { backgroundColor: withAlpha(page, BAR_TINT_ALPHA) },
				scrollEdgeEffects: { top: "hidden" },
			}) satisfies StackOptions,
		[dark, page],
	);
}
