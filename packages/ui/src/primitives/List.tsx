import type { ReactNode } from "react";
import { View } from "react-native";

interface ListProps {
	className?: string;
	children?: ReactNode;
}

/** A list: a `<ul>` on the web, a list for VoiceOver in the app. */
export function List({ className = "", children }: ListProps) {
	return (
		<View role="list" className={className}>
			{children}
		</View>
	);
}

/** One item of a `List`: an `<li>` on the web. */
export function ListItem({ className = "", children }: ListProps) {
	return (
		<View role="listitem" className={className}>
			{children}
		</View>
	);
}
