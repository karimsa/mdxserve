import { AnimatePresence, motion } from "framer-motion";
import { useAtom, useSetAtom } from "jotai";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { queryClient, trpc } from "./api";
import { formatModified, formatSize } from "./format";
import { stagger, TRANSITIONS, VARIANTS } from "./motion";
import { Icon } from "./ui/Icon";
import { ResizeHandle } from "./ui/ResizeHandle";
import { ConfirmDeleteDialog } from "./ui/ConfirmDeleteDialog";
import { pushToast } from "./ui/Toast";
import type { ListingEntry } from "./router";
import Button from "./builtins/Button";
import Dropdown from "./builtins/Dropdown";
import {
	LISTING_MAX_WIDTH,
	LISTING_MIN_WIDTH,
	listingSortAtom,
	listingWidthAtom,
	type SortKey,
} from "./state";

function sortEntries(entries: ListingEntry[], sort: SortKey): ListingEntry[] {
	const byName = (first: ListingEntry, second: ListingEntry) =>
		first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
	return [...entries].sort((first, second) => {
		if (first.isDir !== second.isDir) return first.isDir ? -1 : 1;
		if (sort === "modified") {
			const diff = (second.mtime ?? 0) - (first.mtime ?? 0);
			if (diff !== 0) return diff;
		}
		return byName(first, second);
	});
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
	selectable = false,
	checked = false,
	selectionActive = false,
	onToggle,
	dense = false,
	active = false,
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
	/** Whether this row may be checked for bulk delete (files only; never dirs or ".."). */
	selectable?: boolean;
	checked?: boolean;
	/** Whether any row in the listing is currently selected (keeps unchecked boxes visible). */
	selectionActive?: boolean;
	onToggle?: () => void;
	/** Sidebar mode: tighter padding and smaller type, no checkbox gutter. */
	dense?: boolean;
	/** Sidebar mode: this row is the doc currently being viewed. */
	active?: boolean;
}) {
	const inner = (
		<>
			<Icon
				name={icon === "folder" ? "folder" : "file-text"}
				size={dense ? "sm" : "md"}
				className="shrink-0 text-text-subtle"
			/>
			<span className="flex min-w-0 flex-col">
				{labelHtml ? (
					<span
						className={
							"listing-title truncate font-sans font-medium leading-normal " +
							(dense ? "text-[length:var(--size-sm)]" : "text-[length:var(--size-md)]") +
							(active ? " font-semibold text-text-accent" : "")
						}
						dangerouslySetInnerHTML={{ __html: labelHtml }}
					/>
				) : (
					<span
						className={
							"truncate font-sans font-medium leading-normal " +
							(dense ? "text-[length:var(--size-sm)]" : "text-[length:var(--size-md)]") +
							(active ? " font-semibold text-text-accent" : "")
						}
					>
						{label}
					</span>
				)}
				{sublabel ? (
					<span
						className={
							"truncate font-mono font-normal leading-normal text-text-subtle " +
							(dense ? "text-[length:var(--size-2xs)]" : "text-[length:var(--size-xs)]")
						}
					>
						{sublabel}
					</span>
				) : null}
			</span>
			{typeof mtime === "number" || typeof size === "number" ? (
				<span className="ml-auto flex shrink-0 items-center gap-4 pl-4 font-mono font-normal leading-[1.62] text-[length:var(--size-xs)] text-text-subtle tabular-nums">
					{typeof mtime === "number" ? (
						<span title={new Date(mtime).toLocaleString()}>{formatModified(mtime)}</span>
					) : null}
					{typeof size === "number" ? (
						<span className="w-16 text-right">{formatSize(size)}</span>
					) : null}
				</span>
			) : null}
		</>
	);

	// Dense rows have no checkbox gutter, so give the link its own left inset
	// or the icon sits flush against the active pill's edge.
	const rowPadding = dense ? "py-1.5 pl-2" : "py-2";

	return (
		<motion.div
			variants={rowVariants}
			className={
				"group flex items-center rounded-md " +
				(active ? "relative " : "") +
				(checked ? "bg-surface-active" : active ? "" : "hover:bg-surface-hover")
			}
		>
			{active ? (
				<motion.span
					layoutId="sidebar-active"
					transition={TRANSITIONS.glide}
					className="absolute inset-0 z-0 rounded-md bg-surface-accent-soft"
					aria-hidden="true"
				/>
			) : null}
			{dense ? null : (
				<span data-print-hide className="flex w-7 shrink-0 justify-center">
					{selectable ? (
						<input
							type="checkbox"
							checked={checked}
							aria-label={`Select ${label}`}
							onChange={onToggle}
							className={
								"size-3.5 cursor-pointer accent-[var(--teal-550)] " +
								(checked || selectionActive
									? "opacity-100"
									: "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")
							}
						/>
					) : null}
				</span>
			)}
			{muted || !href ? (
				<div
					className={`flex min-w-0 flex-1 cursor-default items-center gap-2 ${rowPadding} pr-3 text-text-subtle`}
				>
					{inner}
				</div>
			) : (
				// Plain <a>: the router's global click delegation (client/router.ts)
				// intercepts this for client-side navigation; no per-row handler needed.
				// The checkbox above is a sibling, not a descendant, so it never triggers it.
				<a
					href={href}
					aria-current={active ? "page" : undefined}
					className={
						`flex min-w-0 flex-1 items-center gap-2 ${rowPadding} pr-3` +
						(active ? " relative z-10" : "")
					}
				>
					{inner}
				</a>
			)}
		</motion.div>
	);
}

const DAY_PRESETS = [7, 14, 30, 90];
const DAY_MS = 86_400_000;

const MENU_ITEM_BASE =
	"flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-left font-sans text-[length:var(--size-sm)]";

function menuItemClass(enabled: boolean): string {
	return enabled
		? `${MENU_ITEM_BASE} cursor-pointer hover:bg-surface-hover`
		: `${MENU_ITEM_BASE} cursor-default opacity-45`;
}

/** One-shot command menu for bulk-selecting files by age; replaces the current selection. */
function SelectMenu({
	fileEntries,
	onSelect,
}: {
	fileEntries: ListingEntry[];
	onSelect: (names: Set<string>) => void;
}) {
	const [open, setOpen] = useState(false);
	// Snapshot "now" when the menu opens so the live counts don't drift while it's open.
	const [now, setNow] = useState(0);
	const [customDays, setCustomDays] = useState(3);
	const rootRef = useRef<HTMLDivElement>(null);

	function toggle() {
		if (!open) setNow(Date.now());
		setOpen((current) => !current);
	}

	function olderThan(days: number): ListingEntry[] {
		return fileEntries.filter(
			(entry) => typeof entry.mtime === "number" && now - entry.mtime > days * DAY_MS,
		);
	}

	function select(names: Set<string>) {
		onSelect(names);
		setOpen(false);
	}

	// Close on outside click, mirroring client/builtins/Dropdown.tsx.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key === "Escape") {
			event.preventDefault();
			setOpen(false);
		}
	}

	const customMatches = olderThan(customDays);

	return (
		<div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
			<Button
				variant="secondary"
				size="sm"
				icon="list-checks"
				iconRight="chevron-down"
				disabled={fileEntries.length === 0}
				onClick={toggle}
			>
				Select
			</Button>
			<AnimatePresence>
				{open ? (
					<motion.div
						{...VARIANTS.pop}
						className="absolute left-0 top-full z-[var(--z-dropdown)] mt-1 min-w-56 rounded-lg border border-border-default bg-surface-raised p-1 shadow-md"
					>
						<button
							type="button"
							disabled={fileEntries.length === 0}
							onClick={
								fileEntries.length > 0
									? () => select(new Set(fileEntries.map((entry) => entry.name)))
									: undefined
							}
							className={menuItemClass(fileEntries.length > 0)}
						>
							<span>All documents</span>
							<span className="font-mono text-[length:var(--size-xs)] text-text-subtle tabular-nums">
								{fileEntries.length}
							</span>
						</button>
						{DAY_PRESETS.map((days) => {
							const matches = olderThan(days);
							return (
								<button
									key={days}
									type="button"
									disabled={matches.length === 0}
									onClick={
										matches.length > 0
											? () => select(new Set(matches.map((entry) => entry.name)))
											: undefined
									}
									className={menuItemClass(matches.length > 0)}
								>
									<span>Older than {days} days</span>
									<span className="font-mono text-[length:var(--size-xs)] text-text-subtle tabular-nums">
										{matches.length}
									</span>
								</button>
							);
						})}
						<div className="my-1 border-t border-border-subtle" />
						<div className="flex items-center gap-2 px-2.5 py-1.5 font-sans text-[length:var(--size-sm)]">
							<span>Older than</span>
							<input
								type="number"
								min={1}
								value={customDays}
								data-bare-focus
								onChange={(event) => {
									const next = Number(event.target.value);
									setCustomDays(Number.isFinite(next) && next >= 1 ? next : 1);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" && customMatches.length > 0) {
										event.preventDefault();
										select(new Set(customMatches.map((entry) => entry.name)));
									}
								}}
								className="w-12 rounded border border-border-default bg-surface-card px-1 py-0.5 text-center font-mono text-[length:var(--size-xs)] tabular-nums"
							/>
							<span>days</span>
							<span
								className={
									"ml-auto font-mono text-[length:var(--size-xs)] tabular-nums text-text-subtle " +
									(customMatches.length > 0 ? "" : "opacity-45")
								}
							>
								{customMatches.length}
							</span>
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}

const SORT_OPTIONS = [
	{ value: "name", label: "Name" },
	{ value: "modified", label: "Last modified" },
];

export interface ListingViewRoute {
	path: string;
	/** The served root this folder lives in (no trailing slash). */
	rootDir: string;
	entries: ListingEntry[];
}

export function ListingView({
	route,
	singleRoot,
	mode = "page",
	activePath,
}: {
	route: ListingViewRoute;
	/** Whether the server serves only one root — hides the top-of-root parent row. */
	singleRoot: boolean;
	/** "sidebar": slim rail beside a doc — no selection/delete, no mtime/size, no resize handles, icon-only sort. */
	mode?: "page" | "sidebar";
	/** Route path of the doc being viewed; its row gets the active pill (sidebar mode). */
	activePath?: string;
}) {
	const { path, rootDir, entries } = route;
	const sidebar = mode === "sidebar";
	const atRootTop = path === `${rootDir}/`;
	const segments = path.split("/").filter(Boolean);
	const parentSegments = segments.slice(0, -1);
	const parentHref = atRootTop
		? "/"
		: parentSegments.length
			? `/${parentSegments.join("/")}/`
			: "/";
	const showParentRow = !atRootTop || !singleRoot;

	const [sort, setSort] = useAtom(listingSortAtom);
	const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);
	// Non-doc files aren't navigable in the sidebar rail and just cost space there.
	const visible = useMemo(
		() => (sidebar ? sorted.filter((entry) => entry.isDir || entry.isDoc) : sorted),
		[sorted, sidebar],
	);
	const setWidth = useSetAtom(listingWidthAtom);
	const container = useRef<HTMLDivElement>(null);

	const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [pending, setPending] = useState(false);
	useEffect(() => {
		setSelectedNames(new Set());
		setConfirmOpen(false);
	}, [path]);

	const fileEntries = useMemo(() => entries.filter((entry) => entry.isDoc), [entries]);
	// Drop names that left the listing (watcher push, external deletes) from the
	// set itself — otherwise a file recreated with the same name would come back
	// already checked.
	useEffect(() => {
		setSelectedNames((current) => {
			const live = new Set(fileEntries.map((entry) => entry.name));
			const next = new Set([...current].filter((name) => live.has(name)));
			return next.size === current.size ? current : next;
		});
	}, [fileEntries]);
	// Derived pruning as well, so mid-render staleness can't reach the UI or the POST.
	const selected = useMemo(
		() => fileEntries.filter((entry) => selectedNames.has(entry.name)),
		[fileEntries, selectedNames],
	);
	const selectionActive = selected.length > 0;

	const toggleSelected = useCallback((name: string) => {
		setSelectedNames((current) => {
			const next = new Set(current);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});
	}, []);

	// If every selected file vanishes while the dialog is up (external delete +
	// watcher refresh), close it rather than offering to delete nothing.
	useEffect(() => {
		if (confirmOpen && !pending && selected.length === 0) setConfirmOpen(false);
	}, [confirmOpen, pending, selected.length]);

	// Escape clears the selection, unless a popover (e.g. SelectMenu) already
	// consumed it, or the confirm dialog is up (it handles its own Escape).
	// Sidebar mode has no selection to clear, so skip wiring the listener.
	useEffect(() => {
		if (sidebar) return;
		function onKeyDown(event: globalThis.KeyboardEvent) {
			if (event.defaultPrevented || confirmOpen) return;
			if (event.key === "Escape" && selectionActive) setSelectedNames(new Set());
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [sidebar, confirmOpen, selectionActive]);

	const trashMutation = useMutation(
		trpc.moveDocsToTrash.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries(trpc.getFolderListing.queryFilter({ path })),
		}),
	);

	// Ref, not just state: a second click in the same tick would see stale
	// `pending` and fire a duplicate request before React re-renders.
	const pendingRef = useRef(false);
	const handleConfirm = async () => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		const byPath = new Map(selected.map((entry) => [`${path}${entry.name}`, entry.name]));
		try {
			const data = await trashMutation.mutateAsync({ paths: [...byPath.keys()] });
			setConfirmOpen(false);
			if (data.failed.length === 0) {
				setSelectedNames(new Set());
				pushToast({
					tone: "ok",
					icon: "trash-2",
					text: `Moved ${data.deleted.length} ${data.deleted.length === 1 ? "file" : "files"} to Trash`,
				});
			} else {
				// Keep only the failures selected so the user can see and retry them.
				setSelectedNames(
					new Set(
						data.failed
							.map((failure) => byPath.get(failure.path))
							.filter((name): name is string => name !== undefined),
					),
				);
				console.error(data.failed);
				pushToast({
					tone: "danger",
					text: `Couldn't delete ${data.failed.length} of ${byPath.size} files`,
				});
			}
		} catch {
			pushToast({
				tone: "danger",
				text: "Couldn't reach the server",
			});
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<div ref={container} className="relative">
			{sidebar ? null : (
				<>
					<ResizeHandle
						side="left"
						container={container}
						onResize={setWidth}
						label="Resize listing"
						minWidth={LISTING_MIN_WIDTH}
						maxWidth={LISTING_MAX_WIDTH}
					/>
					<ResizeHandle
						side="right"
						container={container}
						onResize={setWidth}
						label="Resize listing"
						minWidth={LISTING_MIN_WIDTH}
						maxWidth={LISTING_MAX_WIDTH}
					/>
				</>
			)}
			{sidebar ? (
				<div data-print-hide className="mb-1 flex justify-end">
					<Dropdown
						icon="arrow-up-down"
						size="sm"
						label="Sort"
						value={sort}
						onChange={(next) => setSort(next as SortKey)}
						options={SORT_OPTIONS}
					/>
				</div>
			) : (
				<div className="mb-2 flex items-center justify-between gap-2">
					<div data-print-hide className="flex items-center gap-2">
						<SelectMenu fileEntries={fileEntries} onSelect={setSelectedNames} />
						{selectionActive ? (
							<>
								<span className="font-sans font-medium leading-normal text-[length:var(--size-sm)] text-text-subtle tabular-nums">
									{selected.length} selected
								</span>
								<Button variant="ghost" size="sm" onClick={() => setSelectedNames(new Set())}>
									Clear
								</Button>
								<Button
									variant="danger"
									size="sm"
									icon="trash-2"
									onClick={() => setConfirmOpen(true)}
								>
									Delete…
								</Button>
							</>
						) : null}
					</div>
					<div className="flex items-center gap-2 font-sans font-medium leading-normal text-[length:var(--size-sm)] text-text-subtle">
						<span>Sort by</span>
						<div className="w-40">
							<Dropdown
								size="sm"
								value={sort}
								onChange={(next) => setSort(next as SortKey)}
								options={SORT_OPTIONS}
							/>
						</div>
					</div>
				</div>
			)}
			<motion.div
				key={sort}
				variants={stagger}
				initial="initial"
				animate="enter"
				className={
					sidebar
						? "flex flex-col gap-0.5"
						: "divide-y divide-border-subtle border-y border-border-subtle"
				}
			>
				{showParentRow ? (
					<Row
						href={parentHref}
						icon="folder"
						label=".."
						muted={false}
						selectable={false}
						dense={sidebar}
						active={false}
					/>
				) : null}
				{visible.map((entry: ListingEntry) => {
					const href = `${path}${entry.name}${entry.isDir ? "/" : ""}`;
					const common = {
						label: entry.name,
						...(sidebar ? {} : { size: entry.size, mtime: entry.mtime }),
					};
					const dense = sidebar;
					const active = sidebar && href === activePath;
					if (entry.isDir) {
						return (
							<Row
								key={entry.name}
								href={href}
								icon="folder"
								muted={false}
								selectable={false}
								dense={dense}
								active={active}
								{...common}
							/>
						);
					}
					const selection =
						sidebar || !entry.isDoc
							? {}
							: {
									selectable: true,
									checked: selectedNames.has(entry.name),
									selectionActive,
									onToggle: () => toggleSelected(entry.name),
								};
					if (entry.isDoc) {
						return (
							<Row
								key={entry.name}
								href={href}
								icon="file"
								muted={false}
								dense={dense}
								active={active}
								{...common}
								{...selection}
								label={entry.title ?? entry.name}
								labelHtml={entry.titleHtml}
								sublabel={entry.title ? entry.name : undefined}
							/>
						);
					}
					return (
						<Row
							key={entry.name}
							href={null}
							icon="file"
							muted
							dense={dense}
							active={active}
							{...common}
							{...selection}
						/>
					);
				})}
			</motion.div>
			{sidebar ? null : (
				<ConfirmDeleteDialog
					open={confirmOpen}
					files={selected}
					pending={pending}
					onCancel={() => {
						if (!pending) setConfirmOpen(false);
					}}
					onConfirm={handleConfirm}
				/>
			)}
		</div>
	);
}
