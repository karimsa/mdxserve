import { useState } from "react";
import { Icon } from "../ui/Icon";
import { type FileTreeProps, type FileNode } from "@mdxserve/shared/builtins/file-tree";

function Row({ node, depth, activePath }: { node: FileNode; depth: number; activePath?: string }) {
	const [open, setOpen] = useState(node.open !== false);
	const isDir = Boolean(node.children);
	const active = Boolean(activePath) && activePath === node.path;

	return (
		<>
			<div
				onClick={isDir ? () => setOpen((isOpen) => !isOpen) : undefined}
				className={`flex h-[26px] items-center gap-2 rounded-sm pr-2 font-mono font-normal leading-[1.62] text-[length:var(--size-xs)] ${
					isDir ? "cursor-pointer" : "cursor-default"
				} ${active ? "bg-surface-accent-soft text-text-accent" : isDir ? "text-text-body" : "text-text-muted"}`}
				style={{ paddingLeft: 8 + depth * 14 }}
			>
				{isDir ? (
					<Icon
						name={open ? "chevron-down" : "chevron-right"}
						size={12}
						className="text-text-subtle"
					/>
				) : (
					<span className="w-3" />
				)}
				<Icon name={isDir ? "folder" : "file-text"} size={13} className="text-text-subtle" />
				<span>{node.name}</span>
			</div>
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

export default function FileTree({ nodes = [], activePath }: FileTreeProps) {
	return (
		<div className="not-prose rounded-lg border border-border-default bg-surface-card p-2">
			{nodes.map((node, index) => (
				<Row
					key={node.path ?? `${node.name}-${index}`}
					node={node}
					depth={0}
					activePath={activePath}
				/>
			))}
		</div>
	);
}
