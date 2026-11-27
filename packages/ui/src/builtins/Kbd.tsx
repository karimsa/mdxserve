import { Text } from "react-native";
import { type KbdProps } from "@mdxserve/shared/builtins/kbd";
import { Inline } from "../primitives/Inline";

/** A key cap in a line of text: a `<kbd>` on the web. */
export default function Kbd({ children }: KbdProps) {
	return (
		<Inline
			element="kbd"
			className="not-prose inline-flex flex-row h-5 min-w-5 items-center justify-center rounded-sm border border-b-2 border-border-default bg-surface-card px-1.5"
		>
			<Text className="font-mono leading-[1.62] text-[length:var(--size-2xs)] font-medium text-text-muted">
				{children}
			</Text>
		</Inline>
	);
}
