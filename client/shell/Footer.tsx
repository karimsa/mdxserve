import { Icon } from "../ui/Icon";
import { docMtime, type Route } from "../router";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function pluralize(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/** "edited just now / N minutes ago / N hours ago / N days ago / a date". */
function formatEdited(mtime: number | undefined): string {
	if (mtime == null) return "unknown edit time";
	const diff = Date.now() - mtime;
	if (diff < MINUTE) return "edited just now";
	if (diff < HOUR) return `edited ${pluralize(Math.floor(diff / MINUTE), "minute")}`;
	if (diff < DAY) return `edited ${pluralize(Math.floor(diff / HOUR), "hour")}`;
	if (diff < WEEK) return `edited ${pluralize(Math.floor(diff / DAY), "day")}`;
	return `edited ${new Date(mtime).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
}

/** Names the source file below a doc's content — the reader should never lose track of it. */
export function Footer({ route }: { route: Extract<Route, { kind: "doc" }> }) {
	const mtime = route.mtime ?? docMtime(route.path);
	return (
		<div className="mt-8 flex items-center gap-2 font-sans font-medium leading-normal text-[length:var(--size-sm)] text-text-subtle">
			<Icon name="file-text" size="sm" strokeWidth="light" />
			<span className="font-mono text-[length:var(--size-xs)]">{route.path}</span>
			<span>·</span>
			<span>{formatEdited(mtime)}</span>
		</div>
	);
}
