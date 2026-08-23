import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { useAtom } from "jotai";
import { useMemo } from "react";
import { stagger } from "./motion";
import { Icon } from "./ui/Icon";
import type { ListingEntry, Route } from "./router";
import Dropdown from "./builtins/Dropdown";
import { listingSortAtom, type SortKey } from "./state";

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sortEntries(entries: ListingEntry[], sort: SortKey): ListingEntry[] {
	const byName = (a: ListingEntry, b: ListingEntry) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	return [...entries].sort((a, b) => {
		if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
		if (sort === "modified") {
			const diff = (b.mtime ?? 0) - (a.mtime ?? 0);
			if (diff !== 0) return diff;
		}
		return byName(a, b);
	});
}

function formatModified(mtime: number): string {
	return formatDistanceToNow(mtime, { addSuffix: true });
}

const rowVariants = {
	initial: { opacity: 0, y: 4 },
	enter: { opacity: 1, y: 0 },
};

function Row({
	href,
	icon,
	label,
	labelHtml,
	sublabel,
	muted,
	size,
	mtime,
}: {
	href: string | null;
	icon: "folder" | "file";
	label: string;
	/** Server-rendered inline HTML for the label; wins over `label` when set. */
	labelHtml?: string;
	/** Secondary line under the label (e.g. the filename when a title is shown). */
	sublabel?: string;
	muted: boolean;
	size?: number;
	mtime?: number;
}) {
	const inner = (
		<>
			<Icon
				name={icon === "folder" ? "folder" : "file-text"}
				size="md"
				className="shrink-0 text-text-subtle"
			/>
			<span className="flex min-w-0 flex-col">
				{labelHtml ? (
					<span
						className="listing-title truncate font-sans font-medium leading-normal text-[length:var(--size-md)]"
						dangerouslySetInnerHTML={{ __html: labelHtml }}
					/>
				) : (
					<span className="truncate font-sans font-medium leading-normal text-[length:var(--size-md)]">
						{label}
					</span>
				)}
				{sublabel ? (
					<span className="truncate font-mono font-normal leading-normal text-[length:var(--size-xs)] text-text-subtle">
						{sublabel}
					</span>
				) : null}
			</span>
			<span className="ml-auto flex shrink-0 items-center gap-4 pl-4 font-mono font-normal leading-[1.62] text-[length:var(--size-xs)] text-text-subtle tabular-nums">
				{typeof mtime === "number" ? (
					<span title={new Date(mtime).toLocaleString()}>{formatModified(mtime)}</span>
				) : null}
				{typeof size === "number" ? (
					<span className="w-16 text-right">{formatSize(size)}</span>
				) : null}
			</span>
		</>
	);

	if (muted || !href) {
		return (
			<motion.div
				variants={rowVariants}
				className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-text-subtle"
			>
				{inner}
			</motion.div>
		);
	}

	// Plain <a>: the router's global click delegation (client/router.ts) intercepts
	// this for client-side navigation; no per-row handler needed.
	return (
		<motion.a
			variants={rowVariants}
			href={href}
			className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-hover"
		>
			{inner}
		</motion.a>
	);
}

export function ListingView({ route }: { route: Extract<Route, { kind: "listing" }> }) {
	const { path, entries } = route;
	const segments = path.split("/").filter(Boolean);
	const parentSegments = segments.slice(0, -1);
	const parentHref = parentSegments.length ? `/${parentSegments.join("/")}/` : "/";

	const [sort, setSort] = useAtom(listingSortAtom);
	const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);

	return (
		<div>
			<div className="mb-2 flex items-center justify-end gap-2 font-sans font-medium leading-normal text-[length:var(--size-sm)] text-text-subtle">
				<span>Sort by</span>
				<div className="w-40">
					<Dropdown
						size="sm"
						value={sort}
						onChange={(next) => setSort(next as SortKey)}
						options={[
							{ value: "name", label: "Name" },
							{ value: "modified", label: "Last modified" },
						]}
					/>
				</div>
			</div>
			<motion.div
				key={sort}
				variants={stagger}
				initial="initial"
				animate="enter"
				className="divide-y divide-border-subtle border-y border-border-subtle"
			>
				{path !== "/" ? <Row href={parentHref} icon="folder" label=".." muted={false} /> : null}
				{sorted.map((entry: ListingEntry) => {
					const href = `${path}${entry.name}${entry.isDir ? "/" : ""}`;
					const common = { label: entry.name, size: entry.size, mtime: entry.mtime };
					if (entry.isDir) {
						return <Row key={entry.name} href={href} icon="folder" muted={false} {...common} />;
					}
					if (entry.isDoc) {
						return (
							<Row
								key={entry.name}
								href={href}
								icon="file"
								muted={false}
								{...common}
								label={entry.title ?? entry.name}
								labelHtml={entry.titleHtml}
								sublabel={entry.title ? entry.name : undefined}
							/>
						);
					}
					return <Row key={entry.name} href={null} icon="file" muted {...common} />;
				})}
			</motion.div>
		</div>
	);
}
