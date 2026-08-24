import { motion } from "framer-motion";
import { shortenHome } from "./format";
import { stagger } from "./motion";
import { Icon } from "./ui/Icon";
import { useTree, type Route, type TreeNode } from "./router";

function countDocs(nodes: TreeNode[] | null): number {
	if (!nodes) return 0;
	let count = 0;
	for (const node of nodes) {
		if (node.isDoc) count++;
		if (node.children) count += countDocs(node.children);
	}
	return count;
}

const rowVariants = {
	initial: { opacity: 0, y: 4 },
	enter: { opacity: 1, y: 0 },
};

/** Landing page listing every mounted root; the server only serves this at "/" when there's more than one. */
export function HomeView({ route }: { route: Extract<Route, { kind: "home" }> }) {
	const { roots } = useTree();
	const treeByDir = new Map((roots ?? []).map((root) => [root.dir, root.tree]));

	return (
		<motion.div
			variants={stagger}
			initial="initial"
			animate="enter"
			className="divide-y divide-border-subtle border-y border-border-subtle"
		>
			{route.roots.map((root) => {
				const docCount = countDocs(treeByDir.get(root.dir) ?? null);
				return (
					<motion.div
						key={root.dir}
						variants={rowVariants}
						className="group flex items-center rounded-md hover:bg-surface-hover"
					>
						{/* Plain <a>: the router's global click delegation (client/router.ts)
						    intercepts this for client-side navigation. */}
						<a
							href={`${root.dir}/`}
							className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-3 pl-2"
						>
							<Icon name="folder" size="md" className="shrink-0 text-text-subtle" />
							<span className="flex min-w-0 flex-col">
								<span className="truncate font-sans font-medium leading-normal text-[length:var(--size-md)]">
									{root.name}
								</span>
								<span className="truncate font-mono font-normal leading-normal text-[length:var(--size-xs)] text-text-subtle">
									{shortenHome(root.dir)}
								</span>
							</span>
							<span className="ml-auto flex shrink-0 items-center gap-4 pl-4 font-mono font-normal leading-[1.62] text-[length:var(--size-xs)] text-text-subtle tabular-nums">
								{docCount} {docCount === 1 ? "doc" : "docs"}
							</span>
						</a>
					</motion.div>
				);
			})}
		</motion.div>
	);
}
