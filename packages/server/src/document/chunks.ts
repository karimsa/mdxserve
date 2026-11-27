/** One piece of a document cut at its h1 and h2 heading lines, for the fallback parse. */
export interface SourceChunk {
	/** 1-based line the chunk starts on. */
	startLine: number;
	/** 1-based last line of the chunk. */
	endLine: number;
	/** The chunk's lines with their own line endings. */
	text: string;
	/** Text of the h1/h2 heading line the chunk starts with, or null for the first chunk. */
	headingText: string | null;
	/** Level of that heading; 1 for the first chunk. */
	level: 1 | 2;
}

const HEADING = /^ {0,3}(#{1,2})(?=[ \t]|$)(.*)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Split text into lines that keep their terminators, counting a lone `\r` as one the way the parser does. */
export function splitLines(text: string): string[] {
	return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
}

/**
 * Cut `source` at each ATX h1 and h2 heading line, skipping the leading
 * frontmatter (its first `frontmatterEndLine` lines) and fenced code. A
 * document with no such heading is one chunk.
 */
export function splitAtTopHeadings(source: string, frontmatterEndLine: number): SourceChunk[] {
	const lines = splitLines(source);
	const chunks: SourceChunk[] = [];
	let current: SourceChunk | null = null;
	let fence: string | null = null;

	lines.forEach((line, index) => {
		const lineNumber = index + 1;
		const content = line.replace(/\r?\n$|\r$/, "");
		let heading: RegExpMatchArray | null = null;
		if (lineNumber > frontmatterEndLine) {
			const marker = content.match(FENCE);
			if (marker) {
				if (!fence) fence = marker[1];
				else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
			} else if (!fence) {
				heading = content.match(HEADING);
			}
		}
		if (heading || current === null) {
			current = {
				startLine: lineNumber,
				endLine: lineNumber,
				text: "",
				headingText: heading
					? heading[2]
							.replace(/[ \t]+#+[ \t]*$/, "")
							.replace(/^#+$/, "")
							.trim()
					: null,
				level: heading ? (heading[1].length as 1 | 2) : 1,
			};
			chunks.push(current);
		}
		current.endLine = lineNumber;
		current.text += line;
	});
	return chunks;
}
