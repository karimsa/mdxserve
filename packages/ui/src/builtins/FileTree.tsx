import { useState } from "react";
import { Text, View } from "react-native";
import { type FileNode, type FileTreeProps } from "@mdxserve/shared/builtins/file-tree";
import { Icon } from "../primitives/Icon";
import { Pressable } from "../primitives/Pressable";

const ROW = "h-[26px] flex-row items-center gap-2 rounded-sm pr-2";

function Row({ node, depth, activePath }: { node: FileNode; depth: number; activePath?: string }) {
	const [open, setOpen] = useState(node.open !== false);
	const isDir = Boolean(node.children);
	const active = Boolean(activePath) && activePath === node.path;
	const fill = active ? "bg-surface-accent-soft" : "";
	const tone = active ? "text-text-accent" : isDir ? "text-text-body" : "text-text-muted";
	const label = (
		<>
			{isDir ? (
				<Icon
					name={open ? "chevron-down" : "chevron-right"}
					size={12}
					className="text-text-subtle"
				/>
			) : (
				<View className="w-3" />
			)}
			<Icon name={isDir ? "folder" : "file-text"} size={13} className="text-text-subtle" />
			<Text className={`font-mono font-normal leading-[1.62] text-[length:var(--size-xs)] ${tone}`}>
				{node.name}
			</Text>
		</>
	);
	const indent = { paddingLeft: 8 + depth * 14 };

	return (
		<>
			{isDir ? (
				<Pressable
					aria-expanded={open}
					onPress={() => setOpen((isOpen) => !isOpen)}
					className={`${ROW} ${fill}`}
					style={indent}
				>
					{label}
				</Pressable>
			) : (
				<View className={`${ROW} web:cursor-default ${fill}`} style={indent}>
					{label}
				</View>
			)}
			{isDir && open
				? node.children!.map((child, index) => (
						<Row
							key={child.path ?? `${child.name}-${index}`}
							node={child}
							depth={depth + 1}
							activePath={activePath}
						/>
					))
				: null}
		</>
	);
}

/** A file and folder tree; pressing a folder opens or closes it. */
export default function FileTree({ nodes = [], activePath }: FileTreeProps) {
	return (
		<View className="not-prose rounded-lg border border-border-default bg-surface-card p-2">
			{nodes.map((node, index) => (
				<Row
					key={node.path ?? `${node.name}-${index}`}
					node={node}
					depth={0}
					activePath={activePath}
				/>
			))}
		</View>
	);
}
