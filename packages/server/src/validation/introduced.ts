import type { Diagnostic } from "./validate.js";

// `line 12`, `Lines 3, 5`, `line 4-9`, `lines 2 and 7`: every run of numbers
// after the word "line(s)". Messages embed positions, so an edit that merely
// shifts a section down would otherwise make an old error look new.
const LINE_REFERENCE = /\blines?\s+\d+(?:\s*(?:,|-|–|and|to)\s*\d+)*/gi;

function keyOf(diagnostic: Diagnostic): string {
	return `${diagnostic.code}\u0000${diagnostic.message.replace(LINE_REFERENCE, "line N")}`;
}

/**
 * The errors in `after` that `before` did not already have. Only `error`
 * severity counts. Errors are compared as a multiset keyed by code plus
 * message with every line number normalized away, never by the `line` field,
 * so moving an existing error to another line is not "introducing" it, while
 * a second copy of an existing error is.
 */
export function introducedErrors(before: Diagnostic[], after: Diagnostic[]): Diagnostic[] {
	const remaining = new Map<string, number>();
	for (const diagnostic of before) {
		if (diagnostic.severity !== "error") continue;
		const key = keyOf(diagnostic);
		remaining.set(key, (remaining.get(key) ?? 0) + 1);
	}
	const introduced: Diagnostic[] = [];
	for (const diagnostic of after) {
		if (diagnostic.severity !== "error") continue;
		const key = keyOf(diagnostic);
		const count = remaining.get(key) ?? 0;
		if (count > 0) remaining.set(key, count - 1);
		else introduced.push(diagnostic);
	}
	return introduced;
}
