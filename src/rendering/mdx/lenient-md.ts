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
	const frontmatterEndLine = metadata.leadingFrontmatter(source)?.endLine ?? 0;
	let fence: string | null = null;
	const state: EscapeState = {
		expressionDepth: 0,
		quote: null,
		blockComment: false,
		inlineTicks: 0,
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
		parts[index] = escapeLine(line, state);
	}
	return parts.join("");
}

interface EscapeState {
	expressionDepth: number;
	quote: "'" | '"' | "`" | null;
	blockComment: boolean;
	inlineTicks: number;
}

function escapeLine(line: string, state: EscapeState): string {
	let escaped = "";
	for (let index = 0; index < line.length; index++) {
		const char = line[index];
		const next = line[index + 1];
		const precedingSlashes = escaped.match(/\\+$/)?.[0].length ?? 0;
		const alreadyEscaped = precedingSlashes % 2 === 1;

		if (state.expressionDepth > 0) {
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
				else if (char === state.quote) state.quote = null;
				continue;
			}
			if (char === "/" && next === "/") return escaped + line.slice(index);
			if (char === "/" && next === "*") {
				state.blockComment = true;
				escaped += "/*";
				index++;
				continue;
			}
			if (char === "'" || char === '"' || char === "`") state.quote = char;
			else if (char === "{") state.expressionDepth++;
			else if (char === "}") state.expressionDepth--;
			escaped += char;
			continue;
		}

		if (char === "`") {
			const ticks = line.slice(index).match(/^`+/)?.[0] ?? "`";
			if (state.inlineTicks === 0) state.inlineTicks = ticks.length;
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
