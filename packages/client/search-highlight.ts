/** A run of a search result's text: matched by a query term, or not. */
export interface HighlightPart {
	text: string;
	match: boolean;
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `text` cut into runs at every case-insensitive occurrence of `terms` (the terms `searchDocs`
 * matched), longest term first, for both clients to highlight the same way. Joining the runs
 * gives `text` back.
 */
export function highlightParts(
	text: string,
	terms: readonly string[] | undefined,
): HighlightPart[] {
	const pattern = (terms ?? [])
		.filter((term) => term.length > 0)
		.sort((first, second) => second.length - first.length)
		.map(escapeRegExp)
		.join("|");
	if (pattern === "") return text === "" ? [] : [{ text, match: false }];
	return text
		.split(new RegExp(`(${pattern})`, "gi"))
		.map((part, index) => ({ text: part, match: index % 2 === 1 }))
		.filter((part) => part.text.length > 0);
}
