import type { ReactNode } from "react";
import { Icon } from "../primitives/Icon";

/**
 * The web's screenshot parts: an `<img>` at its own aspect ratio, a `<figcaption>`, and the
 * expand control as a `<button>` whose `title` is the browser's tooltip, as the web client's
 * icon buttons have.
 */
export function ScreenshotImage({ src, alt }: { src: string; alt: string }) {
	return <img src={src} alt={alt} className="block w-full" />;
}

export function ScreenshotCaption({ children }: { children: ReactNode }) {
	return (
		<figcaption className="border-t border-border-subtle px-4 py-2.5 font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-subtle">
			{children}
		</figcaption>
	);
}

export function ExpandButton({ onPress }: { onPress(): void }) {
	return (
		<button
			type="button"
			aria-label="Expand screenshot"
			title="Expand screenshot"
			onClick={onPress}
			className="-mr-1 ml-auto inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-md border border-transparent text-text-muted transition-[color,background-color,scale] hover:bg-surface-hover active:scale-[0.92]"
		>
			<Icon name="expand" size="sm" />
		</button>
	);
}
