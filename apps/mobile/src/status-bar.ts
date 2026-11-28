import { useUniwind } from "uniwind";

/**
 * The status bar's content colour for the app's theme: light on the dark theme, dark on the
 * light one. The root stack sets it on every screen (app/_layout.tsx), because iOS reads the
 * status bar's style from the top screen (react-native-screens), not from expo-status-bar, and
 * that screen's `"auto"` resolves from whichever traits UIKit last made current. Coming back
 * from the background, after iOS has drawn its light and dark snapshots, that can be the
 * wrong ones, and the status area in a folded iPhone Duo's vertical bar went missing: dark
 * glyphs on the dark bar. A style the app names never depends on them.
 */
export function useStatusBarStyle(): "light" | "dark" {
	return useUniwind().theme === "dark" ? "light" : "dark";
}
