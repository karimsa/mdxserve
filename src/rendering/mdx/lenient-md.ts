import type { MetadataPort } from "../../docs/metadata-port.js";

/**
 * `.md` files are compiled as MDX so builtin components work in both
 * extensions, but that makes a bare `<` followed by a digit, whitespace or
 * `=` (e.g. "(<800px)", "a < b") a hard JSX parse error even though it is
 * perfectly valid Markdown. Such a `<` can never start a JSX tag, so escape it
 * as `\<` in prose. Fenced and inline code is literal, while MDX expressions
 * may contain JavaScript comparisons, so neither is rewritten.
 */
export function escapeBareLt(source: string, metadata: MetadataPort): string {
	const parts = source.split(/(\r\n|\r|\n)/);
	let sourceOffset = 0;
	const partOffsets = parts.map((part) => {
		const offset = sourceOffset;
		sourceOffset += part.length;
		return offset;
	});
	const frontmatterEndLine = metadata.leadingFrontmatter(source)?.endLine ?? 0;
	let fence: string | null = null;
	const state: EscapeState = {
		expressionDepth: 0,
		quote: null,
		blockComment: false,
		inlineTicks: 0,
		regex: false,
		regexClass: false,
		regexAllowed: true,
	};
	for (let index = 0; index < parts.length; index += 2) {
		if (index / 2 < frontmatterEndLine) continue;
		const line = parts[index];
		if (state.expressionDepth === 0 && state.inlineTicks === 0) {
			const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
			if (match) {
				const marker = match[1];
				if (!fence) fence = marker;
				else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
				continue;
			}
		}
		if (fence) continue;
		// Indented code blocks are literal too, unless an expression began above.
		if (state.expressionDepth === 0 && state.inlineTicks === 0 && /^(?: {4}|\t)/.test(line))
			continue;
		parts[index] = escapeLine(line, state, source, partOffsets[index]);
	}
	return parts.join("");
}

interface EscapeState {
	expressionDepth: number;
	quote: "'" | '"' | "`" | null;
	blockComment: boolean;
	inlineTicks: number;
	regex: boolean;
	regexClass: boolean;
	regexAllowed: boolean;
}

function hasClosingTicks(remaining: string, ticks: string): boolean {
	let fence: string | null = null;
	for (const [lineIndex, line] of remaining.split(/\r\n|\r|\n/).entries()) {
		if (lineIndex > 0) {
			const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
			if (marker) {
				if (!fence) fence = marker;
				else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
				continue;
			}
		}
		if (fence) continue;
		for (const match of line.matchAll(/`+/g)) {
			if (match[0].length === ticks.length) return true;
		}
	}
	return false;
}

function escapeLine(line: string, state: EscapeState, source: string, lineOffset: number): string {
	let escaped = "";
	for (let index = 0; index < line.length; index++) {
		const char = line[index];
		const next = line[index + 1];
		const precedingSlashes = escaped.match(/\\+$/)?.[0].length ?? 0;
		const alreadyEscaped = precedingSlashes % 2 === 1;

		if (state.expressionDepth > 0) {
			if (state.regex) {
				escaped += char;
				if (char === "\\") escaped += line[++index] ?? "";
				else if (char === "[") state.regexClass = true;
				else if (char === "]") state.regexClass = false;
				else if (char === "/" && !state.regexClass) {
					state.regex = false;
					state.regexAllowed = false;
				}
				continue;
			}
			if (state.blockComment) {
				if (char === "*" && next === "/") {
					state.blockComment = false;
					escaped += "*/";
					index++;
				} else escaped += char;
				continue;
			}
			if (state.quote) {
				escaped += char;
				if (char === "\\") escaped += line[++index] ?? "";
				else if (char === state.quote) {
					state.quote = null;
					state.regexAllowed = false;
				}
				continue;
			}
			if (char === "/" && next === "/") return escaped + line.slice(index);
			if (char === "/" && next === "*") {
				state.blockComment = true;
				escaped += "/*";
				index++;
				continue;
			}
			if (char === "/" && state.regexAllowed && escaped.at(-1) !== "<") {
				state.regex = true;
				state.regexClass = false;
			} else if ((char === "+" || char === "-") && next === char) {
				escaped += char + char;
				index++;
				continue;
			} else if (char === "'" || char === '"' || char === "`") state.quote = char;
			else if (char === "{") {
				state.expressionDepth++;
				state.regexAllowed = true;
			} else if (char === "}") {
				state.expressionDepth--;
				state.regexAllowed = false;
			} else if (/[A-Za-z_$]/.test(char)) {
				const identifier = line.slice(index).match(/^[A-Za-z_$][\w$]*/)?.[0] ?? char;
				escaped += identifier;
				index += identifier.length - 1;
				state.regexAllowed =
					/^(?:return|throw|case|delete|void|typeof|instanceof|in|of|yield|await)$/.test(
						identifier,
					);
				continue;
			} else if (/\d/.test(char) || char === ")" || char === "]") state.regexAllowed = false;
			else if (!/\s/.test(char)) state.regexAllowed = true;
			escaped += char;
			continue;
		}

		if (char === "`") {
			const ticks = line.slice(index).match(/^`+/)?.[0] ?? "`";
			if (
				state.inlineTicks === 0 &&
				hasClosingTicks(source.slice(lineOffset + index + ticks.length), ticks)
			)
				state.inlineTicks = ticks.length;
			else if (state.inlineTicks === ticks.length) state.inlineTicks = 0;
			escaped += ticks;
			index += ticks.length - 1;
			continue;
		}
		if (state.inlineTicks === 0 && char === "{" && !alreadyEscaped) state.expressionDepth = 1;
		if (state.inlineTicks === 0 && char === "<" && !alreadyEscaped && /[\d\s=]/.test(next ?? ""))
			escaped += "\\";
		escaped += char;
	}
	return escaped;
}
