import type { HighlighterCore, ThemedToken } from "shiki/core";
import { designTokenTheme } from "./shiki-theme";

/** One highlighted line: its tokens, each with the CSS colour the token theme gives it. */
export type HighlightedLine = { content: string; color?: string; fontStyle?: number }[];

const THEME = "mdxserve-tokens";
const PLAIN = new Set(["text", "txt", "plain", "plaintext"]);

let highlighterPromise: Promise<{
	highlighter: HighlighterCore;
	languages: Record<string, () => Promise<unknown>>;
	aliases: Record<string, string>;
}> | null = null;

/**
 * Shiki, its JavaScript regex engine and the grammar list, loaded the first
 * time a page shows a code block and kept for the session. Each grammar is a
 * chunk of its own, fetched when a block in that language first appears.
 */
function loadHighlighter() {
	highlighterPromise ??= Promise.all([
		import("shiki/core"),
		import("shiki/engine/javascript"),
		import("shiki/langs"),
	]).then(async ([core, engine, langs]) => {
		const highlighter = await core.createHighlighterCore({
			themes: [designTokenTheme],
			langs: [],
			engine: engine.createJavaScriptRegexEngine({ forgiving: true }),
		});
		const aliases: Record<string, string> = {};
		for (const info of langs.bundledLanguagesInfo) {
			for (const alias of info.aliases ?? []) aliases[alias] = info.id;
		}
		return {
			highlighter,
			languages: langs.bundledLanguages as unknown as Record<string, () => Promise<unknown>>,
			aliases,
		};
	});
	return highlighterPromise;
}

const cache = new Map<string, HighlightedLine[]>();

function cacheKey(lang: string, code: string): string {
	return `${lang}\u0000${code}`;
}

/** Already-highlighted lines for this code, if a previous render produced them. */
export function cachedHighlight(lang: string | null, code: string): HighlightedLine[] | null {
	if (lang === null) return null;
	return cache.get(cacheKey(lang, code)) ?? null;
}

/**
 * Highlight `code` as `lang` with the design token theme. Null for a language
 * shiki does not know or that is plain text; the caller keeps the plain lines.
 */
export async function highlight(
	lang: string | null,
	code: string,
): Promise<HighlightedLine[] | null> {
	if (lang === null || PLAIN.has(lang.toLowerCase())) return null;
	const key = cacheKey(lang, code);
	const hit = cache.get(key);
	if (hit) return hit;
	const { highlighter, languages, aliases } = await loadHighlighter();
	const id = languages[lang] ? lang : aliases[lang.toLowerCase()];
	if (!id || !languages[id]) return null;
	if (!highlighter.getLoadedLanguages().includes(id)) {
		const grammar = (await languages[id]()) as {
			default: Parameters<HighlighterCore["loadLanguage"]>[0];
		};
		await highlighter.loadLanguage(grammar.default);
	}
	const tokens: ThemedToken[][] = highlighter.codeToTokensBase(code, { lang: id, theme: THEME });
	const lines = tokens.map((line) =>
		line.map((token) => ({
			content: token.content,
			color: token.color,
			fontStyle: token.fontStyle,
		})),
	);
	cache.set(key, lines);
	return lines;
}
