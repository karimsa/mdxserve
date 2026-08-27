/**
 * Pure maths for `Chart` (`Chart.tsx`): number coercion, "nice" axis maxima,
 * tick placement, histogram binning, and the label-fitting used by the
 * horizontal-bar category column. No React or DOM, so this runs in vitest's
 * plain node environment the same way `mermaid-direction.ts` does.
 */

export interface HistogramBin {
	/** `"<start>–<end>"`, formatted to the bin width's precision. */
	label: string;
	/** Count of values that fell in this bin. */
	value: number;
	start: number;
	end: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** `Number(value)` when finite, else `0` — a single bad datum should drop a
    bar or a point, never the whole series (a `NaN` in an SVG path breaks it). */
export function toNumber(value: string | number | undefined): number {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) ? number : 0;
}

/** Rounds `value` up to a "nice" leading digit at its magnitude (94 → 100,
    118 → 200). Non-finite or non-positive input becomes `1`. */
export function niceMax(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 1;
	const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
	return Math.ceil(value / magnitude) * magnitude;
}

/** Unique ascending integer ticks from `0` to `max`, at most `desired`
    of them. Rounding two fractions to the same integer (a small `max`)
    collapses to one tick instead of a visible duplicate. */
export function countTicks(max: number, desired = 5): number[] {
	const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
	const steps = Math.max(1, desired - 1);
	const ticks: number[] = [];
	for (let index = 0; index <= steps; index++) {
		const tick = Math.round((safeMax * index) / steps);
		if (ticks.length === 0 || tick > ticks[ticks.length - 1]!) ticks.push(tick);
	}
	return ticks;
}

/** Sturges' rule (`ceil(log2 n + 1)`), clamped to `[1, 20]` — 5–8 bins for
    the tens-of-values datasets a histogram here is meant for. */
export function autoBinCount(count: number): number {
	if (!Number.isFinite(count) || count <= 0) return 1;
	return clamp(Math.ceil(Math.log2(count) + 1), 1, 20);
}

/** Decimal places implied by `step` — none once a bin spans 10 or more,
    one below that, and enough to show a sub-unit step (`0.03` → 3) — so an
    edge computed as `0.30000000000000004` prints `0.3`, and `22.333…` prints
    `22.3` rather than six noise digits. */
export function formatBinEdge(value: number, step: number): string {
	const size = Number.isFinite(step) ? Math.abs(step) : 0;
	let decimals = 0;
	if (size > 0 && size < 10) {
		decimals = size >= 1 ? 1 : Math.min(6, Math.ceil(-Math.log10(size)) + 1);
	}
	return String(Number(value.toFixed(decimals)));
}

/** Bins finite `values` into equal-width buckets (`bins`, else a Sturges
    estimate, clamped to `[1, 50]`). Every value lands in exactly one
    half-open bin except the last, which is closed at `max`. An empty input
    yields `[]`; a zero-width range (every value equal) yields one bin
    holding everything. */
export function binValues(values: number[], bins?: number): HistogramBin[] {
	const finite = values.filter((value) => Number.isFinite(value));
	if (finite.length === 0) return [];
	const min = Math.min(...finite);
	const max = Math.max(...finite);
	if (max === min) {
		return [{ label: formatBinEdge(min, 1), value: finite.length, start: min, end: max }];
	}
	const count = clamp(bins ?? autoBinCount(finite.length), 1, 50);
	const step = (max - min) / count;
	const counts = new Array(count).fill(0) as number[];
	for (const value of finite) {
		const index = Math.min(count - 1, Math.floor(((value - min) / (max - min)) * count));
		counts[index]++;
	}
	return counts.map((value, index) => {
		const start = min + step * index;
		const end = index === count - 1 ? max : min + step * (index + 1);
		return {
			label: `${formatBinEdge(start, step)}–${formatBinEdge(end, step)}`,
			value,
			start,
			end,
		};
	});
}

/** A stride-thinned subset of `[0, edgeCount)`, always including the first
    and last index, with at most `maxLabels` entries. */
export function edgeTickIndices(edgeCount: number, maxLabels: number): number[] {
	if (edgeCount <= 0) return [];
	if (edgeCount === 1) return [0];
	const cap = Math.max(2, maxLabels);
	if (edgeCount <= cap) return Array.from({ length: edgeCount }, (_element, index) => index);
	const stride = Math.ceil((edgeCount - 1) / (cap - 1));
	const indices: number[] = [];
	for (let index = 0; index < edgeCount; index += stride) indices.push(index);
	if (indices[indices.length - 1] !== edgeCount - 1) indices.push(edgeCount - 1);
	return indices;
}

/** Width in px for a category-label column: the longest label at roughly
    0.58em per character, clamped to `[min, max]`. */
export function labelColumnWidth(
	labels: string[],
	{ fontSize, min, max }: { fontSize: number; min: number; max: number },
): number {
	const longest = labels.reduce((widest, label) => Math.max(widest, label.length), 0);
	return clamp(longest * 0.58 * fontSize + 8, min, max);
}

/** `label` unchanged if it fits in `maxWidth` at `fontSize`, else truncated
    with a trailing `…`. */
export function fitLabel(label: string, maxWidth: number, fontSize: number): string {
	const charWidth = 0.58 * fontSize;
	if (label.length * charWidth <= maxWidth) return label;
	const maxChars = Math.max(1, Math.floor(maxWidth / charWidth) - 1);
	return `${label.slice(0, maxChars)}…`;
}
