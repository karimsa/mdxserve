/**
 * `.md` files are compiled as MDX so builtin components work in both
 * extensions, but that makes a bare `<` followed by a digit, whitespace or
 * `=` (e.g. "(<800px)", "a < b") a hard JSX parse error even though it is
 * perfectly valid Markdown. Such a `<` can never start a JSX tag, so escape it
 * as `\<` — outside fenced and inline code, which MDX already treats literally.
 */
export function escapeBareLt(source: string): string {
	const lines = source.split("\n");
	let fence: string | null = null;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (match) {
			const marker = match[1];
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
			continue;
		}
		if (fence) continue;
		lines[index] = escapeOutsideInlineCode(line);
	}
	return lines.join("\n");
}

function escapeOutsideInlineCode(line: string): string {
	// Indented code blocks are literal too.
	if (/^(?: {4}|\t)/.test(line)) return line;
	// Split on backtick runs and `{...}` expressions; odd-indexed segments are
	// inline code or MDX expressions (where `<` is JavaScript, not JSX).
	const parts = line.split(/(`+[^`]*`+|\{[^{}]*\})/);
	for (let index = 0; index < parts.length; index += 2) {
		parts[index] = parts[index].replace(/(^|[^\\])<(?=[\d\s=])/g, "$1\\<");
	}
	return parts.join("");
}
