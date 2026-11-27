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
	const tag: TagState = { inTag: false, quote: null, nesting: [], comment: false, codeRun: null };
	for (let index = 0; index < parts.length; index += 2) {
		if (index / 2 < frontmatterEndLine) continue;
		const line = parts[index];
		const match = inExpression(tag) ? null : line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (match) {
			const marker = match[1];
			if (!fence) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
			continue;
		}
		if (fence) continue;
		// Whether a later line of this paragraph closes a code span opened here.
		const closesLater = (run: string): boolean => {
			const closing = closingRun(run);
			for (
				let next = index + 2;
				next < parts.length && parts[next].trim() !== "" && !BLOCK_BOUNDARY.test(parts[next]);
				next += 2
			) {
				if (closing.test(parts[next])) return true;
			}
			return false;
		};
		parts[index] = escapeLine(line, tag, closesLater);
	}
	return parts.join("");
}

/**
 * Where the scan is inside a JSX opening tag, carried from one line to the
 * next because a tag's attributes may sit on their own lines.
 *
 * `nesting` is the stack of open `{` (a brace expression or object literal)
 * and `${` (a template-literal substitution). It is empty in the tag's own
 * attribute text. `quote` is the string being read: in the attribute text it
 * is a JSX attribute string (no escapes, only the same quote closes it);
 * inside braces it is a JavaScript string (backslash escapes the next
 * character) or a template literal.
 */
interface TagState {
	inTag: boolean;
	quote: '"' | "'" | "`" | null;
	nesting: Array<"{" | "${">;
	/** Inside a `/* ... *\/` comment in braces, which may span lines. */
	comment: boolean;
	/** The backtick run of an inline code span that continues onto the next line. */
	codeRun: string | null;
}

// A code span closes at a backtick run of exactly the opening length.
const INLINE_CODE = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/y;
// A link or image destination with its optional quoted title: `](url "title")`.
// Only skipped after a `[` on the line, so `](x < 5)` in prose is still escaped.
const LINK_TARGET = /\]\([^\s()]*(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/y;
// A line that ends the current paragraph, so no inline code span crosses it.
const BLOCK_BOUNDARY = /^ {0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|([-*_])(?: *\1){2,} *$)/;
// A whole-line reference definition: `[label]: destination "optional title"`.
const REFERENCE_DEFINITION =
	/^ {0,3}\[[^\]]+\]:\s*(?:<[^>]*>|\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;

/**
 * Escape each bare `<` on one line. Inline code and `{...}` expressions are
 * skipped (there `<` is literal or JavaScript, possibly over several lines), and so is everything between
 * a tag's `<Name` and its closing `>`: a quoted attribute value is literal
 * text, so a backslash added to `title="Latency < 100 ms"` would be displayed.
 *
 * In prose a backslash escapes the character after it, so `\<` is a literal
 * `<` that neither gets another backslash nor starts a tag, while `\\<` is an
 * escaped backslash followed by a real `<`.
 *
 * Inside braces this is not a JavaScript parser: `//` and `/* *\/` comments are
 * skipped, but regex literals are not recognised, so a quote character inside
 * one would be read as the start of a string.
 */
function escapeLine(line: string, tag: TagState, closesLater: (run: string) => boolean): string {
	let output = "";
	let index = 0;
	if (!inExpression(tag) && !tag.codeRun && REFERENCE_DEFINITION.test(line)) {
		// A reference definition: its destination and title are literal.
		return line;
	}
	if (line.trim() === "" && tag.nesting.length === 0) {
		// A tag cannot continue across a blank line, so a `<word` in prose that
		// never closes stops protecting the text after it.
		tag.inTag = false;
		tag.quote = null;
		tag.codeRun = null;
		return line;
	}
	// Indented code blocks are literal too.
	if (!inExpression(tag) && !tag.codeRun && /^(?: {4}|\t)/.test(line)) return line;
	if (tag.codeRun) {
		// Inside an inline code span opened on an earlier line.
		const close = closingRun(tag.codeRun).exec(line);
		if (!close) return line;
		index = close.index + tag.codeRun.length;
		output = line.slice(0, index);
		tag.codeRun = null;
	}
	while (index < line.length) {
		const character = line[index];
		if (inExpression(tag)) {
			const width = scanTagCharacter(line, index, tag);
			output += line.slice(index, index + width);
			index += width;
			continue;
		}
		if (character === "\\") {
			output += line.slice(index, index + 2);
			index += 2;
			continue;
		}
		const skipped =
			character === "`"
				? INLINE_CODE
				: character === "]" && line.lastIndexOf("[", index) >= 0
					? LINK_TARGET
					: null;
		if (skipped) {
			skipped.lastIndex = index;
			const literal = skipped.exec(line);
			if (literal) {
				output += literal[0];
				index += literal[0].length;
				continue;
			}
		}
		if (character === "{") {
			// A prose expression is JavaScript, scanned like one inside a tag.
			tag.nesting.push("{");
			output += character;
			index += 1;
			continue;
		}
		if (character === "`") {
			// No closing run on this line: a span that continues onto a later line
			// of the paragraph is literal, an unmatched backtick is plain text.
			const run = /`+/y;
			run.lastIndex = index;
			const opener = run.exec(line)![0];
			if (closesLater(opener)) {
				tag.codeRun = opener;
				return output + line.slice(index);
			}
			output += opener;
			index += opener.length;
			continue;
		}
		if (character === "<") {
			const next = line[index + 1] ?? "";
			if (/[A-Za-z]/.test(next)) tag.inTag = true;
			else if (/[\d\s=]/.test(next)) output += "\\";
		}
		output += character;
		index += 1;
	}
	return output;
}

/** Whether the scan is inside a JSX opening tag or a `{...}` expression, where `<` is not prose. */
function inExpression(tag: TagState): boolean {
	return tag.inTag || tag.nesting.length > 0;
}

/** Advance the tag state over the character at `index`; returns how many characters it consumed. */
function scanTagCharacter(line: string, index: number, tag: TagState): number {
	const character = line[index];
	const inBraces = tag.nesting.length > 0;
	if (tag.comment) {
		if (character === "*" && line[index + 1] === "/") {
			tag.comment = false;
			return 2;
		}
		return 1;
	}
	if (tag.quote) {
		if (inBraces && character === "\\") return 2;
		if (character === tag.quote) tag.quote = null;
		else if (tag.quote === "`" && character === "$" && line[index + 1] === "{") {
			tag.nesting.push("${");
			tag.quote = null;
			return 2;
		}
		return 1;
	}
	if (inBraces && character === "/" && line[index + 1] === "/") return line.length - index;
	if (inBraces && character === "/" && line[index + 1] === "*") {
		tag.comment = true;
		return 2;
	}
	if (character === '"' || character === "'" || (inBraces && character === "`")) {
		tag.quote = character;
	} else if (character === "{") tag.nesting.push("{");
	else if (character === "}" && inBraces) {
		if (tag.nesting.pop() === "${") tag.quote = "`";
	} else if (character === ">" && !inBraces) tag.inTag = false;
	return 1;
}

/** A backtick run of exactly this length. */
function closingRun(run: string): RegExp {
	return new RegExp("(?<!`)" + run + "(?!`)");
}
