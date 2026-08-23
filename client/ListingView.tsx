import { AnimatePresence, motion } from "framer-motion";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatModified, formatSize } from "./format";
import { stagger, V } from "./motion";
import { Icon } from "./ui/Icon";
import { ResizeHandle } from "./ui/ResizeHandle";
import { ConfirmDeleteDialog } from "./ui/ConfirmDeleteDialog";
import { pushToast } from "./ui/Toast";
import type { ListingEntry, Route } from "./router";
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

	return (
		<motion.div
			variants={rowVariants}
			className={
				"group flex items-center rounded-md " +
				(checked ? "bg-surface-active" : "hover:bg-surface-hover")
			}
		>
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
			{muted || !href ? (
				<div className="flex min-w-0 flex-1 cursor-default items-center gap-2 py-2 pr-3 text-text-subtle">
					{inner}
				</div>
			) : (
				// Plain <a>: the router's global click delegation (client/router.ts)
				// intercepts this for client-side navigation; no per-row handler needed.
				// The checkbox above is a sibling, not a descendant, so it never triggers it.
				<a href={href} className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-3">
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
		return fileEntries.filter((e) => typeof e.mtime === "number" && now - e.mtime > days * DAY_MS);
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
						{...V.pop}
						className="absolute left-0 top-full z-[var(--z-dropdown)] mt-1 min-w-56 rounded-lg border border-border-default bg-surface-raised p-1 shadow-md"
					>
						<button
							type="button"
							disabled={fileEntries.length === 0}
							onClick={
								fileEntries.length > 0
									? () => select(new Set(fileEntries.map((e) => e.name)))
									: undefined
							}
							className={menuItemClass(fileEntries.length > 0)}
						>
							<span>All files</span>
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
											? () => select(new Set(matches.map((e) => e.name)))
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
										select(new Set(customMatches.map((e) => e.name)));
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

export function ListingView({ route }: { route: Extract<Route, { kind: "listing" }> }) {
	const { path, entries } = route;
	const segments = path.split("/").filter(Boolean);
	const parentSegments = segments.slice(0, -1);
	const parentHref = parentSegments.length ? `/${parentSegments.join("/")}/` : "/";

	const [sort, setSort] = useAtom(listingSortAtom);
	const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);
	const setWidth = useSetAtom(listingWidthAtom);
	const container = useRef<HTMLDivElement>(null);

	const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [pending, setPending] = useState(false);
	useEffect(() => {
		setSelectedNames(new Set());
		setConfirmOpen(false);
	}, [path]);

	const fileEntries = useMemo(() => entries.filter((e) => !e.isDir), [entries]);
	// Drop names that left the listing (watcher push, external deletes) from the
	// set itself — otherwise a file recreated with the same name would come back
	// already checked.
	useEffect(() => {
		setSelectedNames((current) => {
			const live = new Set(fileEntries.map((e) => e.name));
			const next = new Set([...current].filter((name) => live.has(name)));
			return next.size === current.size ? current : next;
		});
	}, [fileEntries]);
	// Derived pruning as well, so mid-render staleness can't reach the UI or the POST.
	const selected = useMemo(
		() => fileEntries.filter((e) => selectedNames.has(e.name)),
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
	useEffect(() => {
		function onKeyDown(event: globalThis.KeyboardEvent) {
			if (event.defaultPrevented || confirmOpen) return;
			if (event.key === "Escape" && selectionActive) setSelectedNames(new Set());
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [confirmOpen, selectionActive]);

	// Ref, not just state: a second click in the same tick would see stale
	// `pending` and fire a duplicate request before React re-renders.
	const pendingRef = useRef(false);
	const handleConfirm = async () => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		const byPath = new Map(selected.map((e) => [`${path}${e.name}`, e.name]));
		try {
			const res = await fetch("/__mdxserve/api/delete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ paths: [...byPath.keys()] }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as {
				deleted: string[];
				failed: { path: string; error: string }[];
			};
			setConfirmOpen(false);
			if (data.failed.length === 0) {
				setSelectedNames(new Set());
				pushToast({
					tone: "ok",
					icon: "trash-2",
					title: `Moved ${data.deleted.length} ${data.deleted.length === 1 ? "file" : "files"} to Trash`,
				});
			} else {
				// Keep only the failures selected so the user can see and retry them.
				setSelectedNames(
					new Set(
						data.failed.map((f) => byPath.get(f.path)).filter((n): n is string => n !== undefined),
					),
				);
				pushToast({
					tone: "danger",
					title: `Couldn't delete ${data.failed.length} of ${byPath.size} files`,
					message: data.failed[0].error,
				});
			}
		} catch {
			pushToast({
				tone: "danger",
				title: "Delete failed",
				message: "The server couldn't be reached.",
			});
		} finally {
			pendingRef.current = false;
			setPending(false);
		}
	};

	return (
		<div ref={container} className="relative">
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
							options={[
								{ value: "name", label: "Name" },
								{ value: "modified", label: "Last modified" },
							]}
						/>
					</div>
				</div>
			</div>
			<motion.div
				key={sort}
				variants={stagger}
				initial="initial"
				animate="enter"
				className="divide-y divide-border-subtle border-y border-border-subtle"
			>
				{path !== "/" ? (
					<Row href={parentHref} icon="folder" label=".." muted={false} selectable={false} />
				) : null}
				{sorted.map((entry: ListingEntry) => {
					const href = `${path}${entry.name}${entry.isDir ? "/" : ""}`;
					const common = { label: entry.name, size: entry.size, mtime: entry.mtime };
					if (entry.isDir) {
						return (
							<Row
								key={entry.name}
								href={href}
								icon="folder"
								muted={false}
								selectable={false}
								{...common}
							/>
						);
					}
					const selection = {
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
								{...common}
								{...selection}
								label={entry.title ?? entry.name}
								labelHtml={entry.titleHtml}
								sublabel={entry.title ? entry.name : undefined}
							/>
						);
					}
					return <Row key={entry.name} href={null} icon="file" muted {...common} {...selection} />;
				})}
			</motion.div>
			<ConfirmDeleteDialog
				open={confirmOpen}
				files={selected}
				pending={pending}
				onCancel={() => {
					if (!pending) setConfirmOpen(false);
				}}
				onConfirm={handleConfirm}
			/>
		</div>
	);
}
