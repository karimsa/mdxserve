export type SpliceResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Replace the 1-indexed, inclusive line range `[startLine, endLine]` of
 * `text` with `replacement`, preserving `text`'s EOL style (CRLF vs LF) and
 * whether it ends with a trailing newline. Pure and synchronous — used by the
 * save endpoint to turn a Tiptap-serialized markdown section back into a full
 * file, and independently property-tested.
 */
export function spliceLines(
	text: string,
	startLine: number,
	endLine: number,
	replacement: string,
): SpliceResult {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const endsWithEol = /\r?\n$/.test(text);

	// split(/\r?\n/) turns a trailing EOL into a trailing empty element (e.g.
	// "a\nb\n" -> ["a", "b", ""]); drop it so line numbers match what a reader
	// (and the client, slicing the same way) would call "line N". An empty
	// string has no lines at all, not one empty line.
	let lines = text === "" ? [] : text.split(/\r?\n/);
	if (endsWithEol) lines = lines.slice(0, -1);

	if (
		!Number.isInteger(startLine) ||
		!Number.isInteger(endLine) ||
		startLine < 1 ||
		endLine < startLine ||
		endLine > lines.length
	) {
		return {
			ok: false,
			error: `Invalid line range [${startLine}, ${endLine}] for ${lines.length} lines`,
		};
	}

	// Normalise the incoming replacement to bare "\n" and drop any trailing
	// newline(s) before splitting, so the caller doesn't have to worry about
	// double newlines at the join point below. An empty replacement therefore
	// contributes exactly one empty line, which is fine — it reads as "this
	// range became a blank line" and callers can pass "" to blank a range if
	// they want.
	const normalized = replacement.replace(/\r\n/g, "\n").replace(/\n+$/, "");
	const replacementLines = normalized.split("\n");

	const spliced = [...lines.slice(0, startLine - 1), ...replacementLines, ...lines.slice(endLine)];

	return { ok: true, text: spliced.join(eol) + (endsWithEol ? eol : "") };
}
