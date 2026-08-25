/**
 * Whether the user is on an Apple platform, for keyboard hints (⌘ vs Ctrl).
 * Shared by TopBar's search hint and the section editor's save/cancel hints.
 * `navigator.platform` is deprecated but still the one signal every browser
 * exposes synchronously; guard it so the SSR render worker can import this.
 */
export function isApplePlatform(): boolean {
	return typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
}

/**
 * The viewport width at which the shell docks the sidebar instead of using a
 * drawer — Tailwind's `md`. Anything narrower is treated as a phone-sized
 * screen by every component that adapts its layout.
 */
export const DESKTOP_MEDIA = "(min-width: 768px)";
