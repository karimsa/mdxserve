import type { MetadataPort } from "../docs/metadata-port.js";

/**
 * Every document, `.md` or `.mdx`, is parsed as MDX so builtin components
 * work in both extensions, but that makes a bare `<` followed by a digit,
 * whitespace or `=` (e.g. "(<800px)", "a < b") a hard JSX parse error even
 * though it is perfectly valid Markdown. Such a `<` can never start a JSX tag,
 * so escape it as `\<` — outside fenced and inline code, which MDX already
 * treats literally. Applied to both extensions alike.
 */
export function escapeBareLt(
	source: string,
	metadata: Pick<MetadataPort, "leadingFrontmatter">,
): string {
	const parts = source.split(/(\r\n|\r|\n)/);
	const frontmatterEndLine = metadata.leadingFrontmatter(source)?.endLine ?? 0;
	let fence: string | null = null;
	const tag: TagState = { inTag: false, quote: null, braceDepth: 0 };
	for (let index = 0; index < parts.length; index += 2) {
		if (index / 2 < frontmatterEndLine) continue;
		const line = parts[index];
		const match = tag.inTag ? null : line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (match) {
			const marker = match[1];
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
			continue;
		}
		if (fence) continue;
		parts[index] = escapeLine(line, tag);
	}
	return parts.join("");
}

/**
 * Where the scan is inside a JSX opening tag, carried from one line to the
 * next because a tag's attributes may sit on their own lines.
 */
interface TagState {
	inTag: boolean;
	quote: '"' | "'" | null;
	braceDepth: number;
}

const INLINE_CODE = /`+[^`]*`+/y;
const INLINE_EXPRESSION = /\{[^{}]*\}/y;

/**
 * Escape each bare `<` on one line. Inline code and `{...}` expressions are
 * skipped (there `<` is literal or JavaScript), and so is everything between
 * a tag's `<Name` and its closing `>`: a quoted attribute value is literal
 * text, so a backslash added to `title="Latency < 100 ms"` would be displayed.
 */
function escapeLine(line: string, tag: TagState): string {
	if (line.trim() === "" && tag.braceDepth === 0) {
		// A tag cannot continue across a blank line, so a `<word` in prose that
		// never closes stops protecting the text after it.
		tag.inTag = false;
		tag.quote = null;
		return line;
	}
	// Indented code blocks are literal too.
	if (!tag.inTag && /^(?: {4}|\t)/.test(line)) return line;
	let output = "";
	let index = 0;
	while (index < line.length) {
		const character = line[index];
		if (tag.inTag) {
			if (tag.quote) {
				if (character === tag.quote) tag.quote = null;
			} else if (character === '"' || character === "'") tag.quote = character;
			else if (tag.braceDepth > 0) {
				if (character === "{") tag.braceDepth += 1;
				else if (character === "}") tag.braceDepth -= 1;
			} else if (character === "{") tag.braceDepth = 1;
			else if (character === ">") tag.inTag = false;
			output += character;
			index += 1;
			continue;
		}
		const skipped = character === "`" ? INLINE_CODE : character === "{" ? INLINE_EXPRESSION : null;
		if (skipped) {
			skipped.lastIndex = index;
			const literal = skipped.exec(line);
			if (literal) {
				output += literal[0];
				index += literal[0].length;
				continue;
			}
		}
		if (character === "<") {
			const next = line[index + 1] ?? "";
			if (/[A-Za-z]/.test(next)) tag.inTag = true;
			else if (/[\d\s=]/.test(next) && line[index - 1] !== "\\") output += "\\";
		}
		output += character;
		index += 1;
	}
	return output;
}
