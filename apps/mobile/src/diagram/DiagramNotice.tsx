import { Text, View } from "react-native";
import { Icon } from "@mdxserve/ui/primitives/Icon";

/**
 * A notice in a diagram's place, as the web client shows it: a Mermaid error (its message in
 * monospace) or a chart diagram refused on purpose.
 */
export function DiagramNotice({
	heading,
	children,
	monospace = false,
}: {
	heading: string;
	children: string;
	monospace?: boolean;
}) {
	return (
		<View role="alert" accessible={true} className="flex-row items-start gap-2 p-4">
			<Icon name="octagon-alert" size="sm" className="mt-0.5 text-status-danger-fg" />
			<View className="flex-1">
				<Text className="mb-2 font-sans font-semibold text-[length:var(--size-sm)] text-status-danger-fg">
					{heading}
				</Text>
				<Text
					selectable={true}
					className={
						monospace
							? "font-mono text-[length:var(--size-xs)] text-text-muted"
							: "font-sans text-[length:var(--size-sm)] text-text-muted"
					}
				>
					{children}
				</Text>
			</View>
		</View>
	);
}
