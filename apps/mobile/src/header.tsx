import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
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
 * How much of the page colour (`--surface-page`) lies over the blur behind the bar: the one
 * number to tune from how the bar looks on a device. Lower shows more of the content beneath.
 */
const BAR_TINT_OPACITY = 0.6;
/** How strongly the content under the bar is blurred, from 1 to 100 (expo-blur's `intensity`). */
const BAR_BLUR_INTENSITY = 40;

/**
 * The bar's background, drawn by the app: content under the bar blurred, with the page colour
 * over it at `BAR_TINT_OPACITY`. React Navigation lays it out over the status bar and the bar,
 * the screen's full width, and it takes no touches, so the bar's items above it keep theirs.
 */
function BarBackground() {
	const dark = useUniwind().theme === "dark";
	return (
		<View pointerEvents="none" style={StyleSheet.absoluteFill} testID="header-background">
			<BlurView
				tint={dark ? "dark" : "light"}
				intensity={BAR_BLUR_INTENSITY}
				style={StyleSheet.absoluteFill}
			/>
			<View
				style={[StyleSheet.absoluteFill, { opacity: BAR_TINT_OPACITY }]}
				className="bg-surface-page"
			/>
		</View>
	);
}

/**
 * `WORDMARK_HEADER` on a translucent bar the app draws itself (`BarBackground`): the native
 * header stays fully transparent, because react-native-screens draws any header colour that is
 * not fully transparent as an opaque bar (`configureWithOpaqueBackground`). The header is
 * transparent on every iOS version, so content starts below the bar the same way everywhere:
 * scroll views inset themselves under it (`contentInsetAdjustmentBehavior="automatic"`). iOS 26's
 * own scroll edge effect at the top is off, since the background does its job and the two would
 * stack.
 */
export const WORDMARK_HEADER_ON_GLASS = {
	...WORDMARK_HEADER,
	headerTransparent: true,
	headerBackground: () => <BarBackground />,
	scrollEdgeEffects: { top: "hidden" },
} satisfies StackOptions;
