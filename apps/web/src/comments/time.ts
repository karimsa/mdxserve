const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * A compact age for a message header: "now", "12m", "3h", "2d", then a short
 * date ("Nov 24") once it is a week old. Empty for a missing or unparsable
 * timestamp. The full date and time is on the element's title.
 */
export function relativeTime(iso: string | undefined, now: number = Date.now()): string {
	if (!iso) return "";
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const elapsed = Math.round((now - then) / 1000);
	if (elapsed < 45) return "now";
	if (elapsed < HOUR) return `${Math.max(1, Math.floor(elapsed / MINUTE))}m`;
	if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
	if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
	return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
