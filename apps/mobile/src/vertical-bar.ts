import { requireOptionalNativeModule } from "expo";
import { useWindowDimensions } from "react-native";
import type { VerticalBarBehaviorIOS } from "expo-status-bar";

/**
 * The narrowest window, in points, that gets a horizontal top bar. A folded iPhone Duo's outer
 * display (and any phone in portrait) is narrower; its unfolded inner display is wider.
 */
export const WIDE_WINDOW = 600;

/**
 * Whether iOS may move the status bar and the navigation items into a vertical bar beside the
 * content (iOS 27.1, iPhone Duo). In a narrow window the vertical bar leaves the content the
 * most room; in a wide one the items belong in the top bar (`'disabled'`, through
 * `UIViewController.preferredVerticalBarBehavior`). Decided from the window's width, never from
 * the device model, and only once the native module can apply it: an Expo Go built before
 * expo-status-bar 58.0.4 has no `setVerticalBarBehavior`, and the bar then stays automatic.
 */
export function useVerticalBarBehavior(): VerticalBarBehaviorIOS {
	const { width } = useWindowDimensions();
	return width >= WIDE_WINDOW && canSetVerticalBarBehavior() ? "disabled" : "automatic";
}

function canSetVerticalBarBehavior(): boolean {
	const statusBar = requireOptionalNativeModule<{ setVerticalBarBehavior?: unknown }>(
		"ExpoStatusBar",
	);
	return typeof statusBar?.setVerticalBarBehavior === "function";
}
