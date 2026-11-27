import type { ReactNode } from "react";
import { View } from "react-native";

export interface InlineProps {
	className: string;
	children?: ReactNode;
	"aria-hidden"?: boolean;
}

/**
 * A box that sits in a line of text, such as a badge inside a paragraph. React Native lays
 * out a `View` nested in a `Text` inline on its own; the web needs a phrasing element
 * instead (Inline.web.tsx).
 */
export function Inline({ className, children, "aria-hidden": ariaHidden }: InlineProps) {
	return (
		<View className={className} aria-hidden={ariaHidden}>
			{children}
		</View>
	);
}
