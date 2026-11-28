import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import type { CodeNode } from "@mdxserve/client/document/tree-types";
import { MarkedText } from "@mdxserve/ui/document/elements";

/**
 * A code block's source in monospace, scrolled sideways when a line is wider than the frame,
 * with the comment highlights of `source` (the code node) when it is given.
 */
export function CodeText({ value, source }: { value: string; source?: CodeNode }) {
	return (
		<ScrollView horizontal={true} showsHorizontalScrollIndicator={false}>
			<Text
				selectable={true}
				className="p-4 font-mono text-[length:var(--size-xs)] leading-5 text-code-fg"
			>
				{source ? <MarkedText source={source} value={value} code={true} /> : value}
			</Text>
		</ScrollView>
	);
}

/**
 * The frame around a fenced code block: a header with its title or language, and the source.
 * A Mermaid block (src/diagram/DiagramBlock.tsx) puts its toggle in `actions` and its own body
 * in `children`.
 */
export function CodeFrame({
	node,
	label = node.title ?? node.lang,
	actions,
	children,
}: {
	node: CodeNode;
	label?: string | null;
	actions?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<View className="my-2 overflow-hidden rounded-lg border border-code-border bg-code-bg">
			{label || actions ? (
				<View className="min-h-[38px] flex-row items-center border-b border-code-border pl-4">
					<Text
						numberOfLines={1}
						className="flex-1 font-mono text-[length:var(--size-xs)] text-text-subtle"
					>
						{label}
					</Text>
					{actions}
				</View>
			) : null}
			{children ?? <CodeText value={node.value} source={node} />}
		</View>
	);
}
