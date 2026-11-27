import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The space every screen keeps from the window's edges, inside the safe area. */
const GUTTER = 16;

/**
 * Left and right padding that keeps a screen's content beside whatever the system draws on
 * that side: the vertical bar a folded display puts its status and navigation items in, or a
 * landscape iPhone's sensor housing. The native stack only clears the top on its own, and the
 * values come from the safe area, never from a device check.
 */
export function useSideInsets(): { paddingLeft: number; paddingRight: number } {
	const insets = useSafeAreaInsets();
	return { paddingLeft: GUTTER + insets.left, paddingRight: GUTTER + insets.right };
}
