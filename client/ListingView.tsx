import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stagger, T } from "./motion";
import { Icon } from "./ui/Icon";
import type { ListingEntry, Route } from "./router";
import Dropdown from "./builtins/Dropdown";
import {
	LISTING_MAX_WIDTH,
	LISTING_MIN_WIDTH,
	listingSortAtom,
	listingWidthAtom,
	type SortKey,
} from "./state";

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

function clampListingWidth(px: number, max: number): number {
	return Math.min(Math.min(LISTING_MAX_WIDTH, max), Math.max(LISTING_MIN_WIDTH, Math.round(px)));
}

/** Gap between the list's edge and the resize handle's resting line. */
const HANDLE_INSET = 12;
/** Hover zone width: covers the inset gap plus room on either side of the line. */
const HANDLE_ZONE = 40;

type HandleState = "idle" | "hover" | "drag";

const handleBar: Record<
	HandleState,
	{ width: number; height: string; opacity: number; backgroundColor: string }
> = {
	// A short muted pill at rest, so the affordance is discoverable.
	idle: { width: 3, height: "40px", opacity: 0.6, backgroundColor: "var(--border-default)" },
	// Full-height line on hover.
	hover: { width: 2, height: "100%", opacity: 1, backgroundColor: "var(--border-default)" },
	// Thicker and teal while dragging.
	drag: { width: 4, height: "100%", opacity: 1, backgroundColor: "var(--surface-accent)" },
};

/**
 * Resize handle just outside one edge of the listing. The hover zone is wide
 * (it spans the inset gap) so it's easy to find; the bar itself rests as a
 * short pill, grows to a full-height line on hover, and thickens + turns teal
 * mid-drag. The list is centred in <main>, so moving one edge by `d` changes
 * the width by `2d` — computed from the list's centre rather than accumulated
 * deltas so the drag can't drift.
 */
function ListingResizeHandle({
	side,
	container,
	onResize,
}: {
	side: "left" | "right";
	container: React.RefObject<HTMLDivElement | null>;
	onResize: (width: number) => void;
}) {
	const [hovered, setHovered] = useState(false);
	const [dragging, setDragging] = useState(false);
	const draggingRef = useRef(false);

	useEffect(() => {
		return () => {
			if (!draggingRef.current) return;
			draggingRef.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
	}, []);

	const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		draggingRef.current = true;
		setDragging(true);
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// Not a live pointer (synthetic event); the drag still works while the cursor stays in the zone.
		}
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	}, []);

	const onPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!draggingRef.current || !container.current) return;
			const rect = container.current.getBoundingClientRect();
			const centre = rect.left + rect.width / 2;
			const half = side === "right" ? event.clientX - centre : centre - event.clientX;
			// <main> has px-8 on each side; never let the list run under its padding.
			const main = container.current.closest("main");
			const max = main ? main.clientWidth - 64 : LISTING_MAX_WIDTH;
			onResize(clampListingWidth((half - HANDLE_INSET) * 2, max));
		},
		[container, onResize, side],
	);

	const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		draggingRef.current = false;
		setDragging(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	}, []);

	const state: HandleState = dragging ? "drag" : hovered ? "hover" : "idle";
	// Centre the bar on the inset line: the zone starts at the list edge and
	// extends outward, so the line sits HANDLE_INSET in from the zone's inner edge.
	const zoneStyle =
		side === "right"
			? { right: -HANDLE_ZONE, paddingLeft: HANDLE_INSET }
			: { left: -HANDLE_ZONE, paddingRight: HANDLE_INSET };

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize listing"
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			style={{ width: HANDLE_ZONE, ...zoneStyle }}
			className={
				"absolute inset-y-0 z-10 flex cursor-col-resize items-center " +
				(side === "right" ? "justify-start" : "justify-end")
			}
		>
			<motion.div
				initial={false}
				animate={handleBar[state]}
				transition={{ ...T.snap, opacity: T.fast, backgroundColor: T.fast }}
				className="shrink-0 rounded-full"
			/>
		</div>
	);
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
	const setWidth = useSetAtom(listingWidthAtom);
	const container = useRef<HTMLDivElement>(null);

	return (
		<div ref={container} className="relative">
			<ListingResizeHandle side="left" container={container} onResize={setWidth} />
			<ListingResizeHandle side="right" container={container} onResize={setWidth} />
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
