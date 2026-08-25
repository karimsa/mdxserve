/**
 * Read and rewrite the layout direction of a mermaid flowchart without touching
 * anything else in the source. The reader can flip a diagram between top-down
 * and left-right for their own view; the markdown on disk (and the text the
 * copy button hands out) is never changed, so these helpers are the only place
 * that knows how a direction is spelled.
 *
 * Mermaid spells the header as `flowchart LR`, `graph TD`, `flowchart-elk BT`,
 * optionally with a trailing `;`, and treats `TD` as an alias of `TB`. It may be
 * preceded by a `---` front-matter block, `%%` comments, and `%%{init: …}%%`
 * directives, which is why the header is located line by line instead of with
 * a single anchored regex.
 */

export const FLOW_DIRECTIONS = ["TB", "BT", "LR", "RL"] as const;

export type FlowDirection = (typeof FLOW_DIRECTIONS)[number];

/**
 * Captures the keyword (1), the whitespace before the direction (2) and the
 * direction (3); the lookahead keeps `graphs` or `flowchartX` from matching.
 */
const HEADER = /^(\s*(?:flowchart|graph)(?:-elk)?)(?:(\s+)(TB|TD|BT|LR|RL))?(?=[\s;]|$)/;

function normalize(direction: string): FlowDirection {
	return direction === "TD" ? "TB" : (direction as FlowDirection);
}

/**
 * Index of the line holding the `flowchart`/`graph` header, or -1 when the
 * source is not a flowchart. Skips a leading front-matter block and any
 * comment or directive lines (including a directive spanning several lines);
 * the first line that is none of those must be the header.
 */
function headerLineIndex(lines: string[]): number {
	let index = 0;
	while (index < lines.length && lines[index]!.trim() === "") index++;
	if (lines[index]?.trim() === "---") {
		const close = lines.findIndex((line, at) => at > index && line.trim() === "---");
		if (close === -1) return -1;
		index = close + 1;
	}
	let inDirective = false;
	for (; index < lines.length; index++) {
		const line = lines[index]!;
		if (inDirective) {
			if (line.includes("}%%")) inDirective = false;
			continue;
		}
		const trimmed = line.trim();
		if (trimmed === "") continue;
		if (trimmed.startsWith("%%")) {
			if (trimmed.startsWith("%%{") && !trimmed.includes("}%%")) inDirective = true;
			continue;
		}
		return HEADER.test(line) ? index : -1;
	}
	return -1;
}

/**
 * The direction a flowchart lays out in, or null when `source` is some other
 * kind of diagram. A bare `flowchart` header with no direction reads as `TB`,
 * which is what mermaid falls back to.
 */
export function readFlowchartDirection(source: string): FlowDirection | null {
	const lines = source.split("\n");
	const index = headerLineIndex(lines);
	if (index === -1) return null;
	const match = HEADER.exec(lines[index]!);
	return normalize(match?.[3] ?? "TB");
}

/**
 * `source` with its flowchart laid out in `direction`. Only the header line
 * changes; a source that is not a flowchart, or one already in that direction
 * (`TD` counts as `TB`), comes back unchanged.
 */
export function setFlowchartDirection(source: string, direction: FlowDirection): string {
	const lines = source.split("\n");
	const index = headerLineIndex(lines);
	if (index === -1) return source;
	const header = lines[index]!;
	const match = HEADER.exec(header);
	if (!match) return source;
	if (normalize(match[3] ?? "TB") === direction) return source;
	const rest = header.slice(match[0].length);
	lines[index] = `${match[1]}${match[2] ?? " "}${direction}${rest}`;
	return lines.join("\n");
}
