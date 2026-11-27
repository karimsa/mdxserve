import { useEffect, useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MermaidDiagram } from "./Mermaid";
import {
	readFlowchartDirection,
	setFlowchartDirection,
	type FlowDirection,
} from "./mermaid-direction";
import { useMediaQuery } from "./hooks";
import { DESKTOP_MEDIA } from "./platform";
import Dropdown from "./ui/Dropdown";
import { TRANSITIONS } from "./motion";
import { CrossFade } from "./CrossFade";
import { Icon } from "./ui/Icon";
import { cachedHighlight, highlight, type HighlightedLine } from "./highlight";

/**
 * A fenced code block from the document tree, styled from the design tokens
 * (bg-code-bg / border-code-border / text-code-fg — see
 * packages/ui/src/tokens/colors.css). The code arrives as plain text and is
 * highlighted here with shiki, loaded as a lazy chunk on the first block; the
 * plain lines show until it lands. apps/web/src/app.css styles this markup:
 *
 *   <pre data-language data-theme>
 *     <code data-language data-theme style="display:grid"
 *           data-line-numbers? data-line-numbers-max-digits?>
 *       <span data-line data-highlighted-line?>…</span>
 *     </code>
 *   </pre>
 *
 * `CodeFrameHeader` is the frame's header bar, exported on its own so other
 * framed code-like surfaces (e.g. the Diff builtin) can reuse the same chrome.
 */

/**
 * The 34px header bar shared by every code-shaped frame: a mono filename/
 * language label on the left, arbitrary actions (copy button, view toggle) on
 * the right.
 */
export function CodeFrameHeader({ label, actions }: { label?: ReactNode; actions?: ReactNode }) {
	return (
		<div className="flex h-[38px] items-center gap-3 border-b border-code-border pr-2.5 pl-4">
			<span className="min-w-0 flex-1 truncate font-mono text-[length:var(--size-xs)] text-text-subtle">
				{label}
			</span>
			{/* Each action is its own group; a hairline keeps a segmented control and
          the copy button from reading as one cluster. */}
			{actions ? (
				<div className="flex items-center gap-3 [&>*+*]:border-l [&>*+*]:border-code-border [&>*+*]:pl-3">
					{actions}
				</div>
			) : null}
		</div>
	);
}

/** Copy-to-clipboard button with a crossfading copy/check icon and label. */
function CopyButton({ getText }: { getText: () => string }) {
	const [copied, setCopied] = useState(false);

	async function handleCopy() {
		const text = getText();
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// clipboard unavailable; ignore
		}
	}

	return (
		<motion.button
			type="button"
			onClick={handleCopy}
			layout
			whileTap={{ scale: 0.94 }}
			transition={TRANSITIONS.snap}
			className={
				"inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-sm px-2 font-sans text-[length:var(--size-xs)] font-medium leading-none transition-colors " +
				(copied ? "text-text-accent" : "text-text-subtle hover:text-text-heading")
			}
		>
			<AnimatePresence mode="wait" initial={false}>
				<motion.span
					key={copied ? "done" : "idle"}
					initial={{ opacity: 0, y: -3 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: 3 }}
					transition={TRANSITIONS.fast}
					className="inline-flex items-center gap-1.5"
				>
					<Icon name={copied ? "check" : "copy"} size={13} />
					{copied ? "Copied" : "Copy"}
				</motion.span>
			</AnimatePresence>
		</motion.button>
	);
}

const DIRECTION_ICON: Record<FlowDirection, string> = {
	TB: "arrow-down",
	BT: "arrow-up",
	LR: "arrow-right",
	RL: "arrow-left",
};

const DIRECTION_LABEL: Record<FlowDirection, string> = {
	TB: "Top to bottom",
	BT: "Bottom to top",
	LR: "Left to right",
	RL: "Right to left",
};

/**
 * Picks how a flowchart is laid out for the reader's view only: the source
 * on disk, the code pane and the copy button all keep the author's direction.
 * An icon-only trigger showing the current direction, opening the same menu
 * the sidebar uses for sorting; the author's own direction is marked so the
 * reader can always find the way back.
 */
function DirectionMenu({
	value,
	authored,
	onChange,
}: {
	value: FlowDirection;
	/** The direction written in the source. */
	authored: FlowDirection;
	onChange: (direction: FlowDirection) => void;
}) {
	return (
		<Dropdown
			icon={DIRECTION_ICON[value]}
			size="sm"
			label="Layout"
			value={value}
			onChange={(next) => onChange(next as FlowDirection)}
			options={(Object.keys(DIRECTION_LABEL) as FlowDirection[]).map((direction) => ({
				value: direction,
				label: DIRECTION_LABEL[direction],
				description: direction === authored ? "As written" : undefined,
			}))}
		/>
	);
}

/** Diagram/Code segmented pill for mermaid frames; the active pill slides via `layoutId`. */
function ViewToggle({
	view,
	onChange,
	toggleId,
}: {
	view: "diagram" | "code";
	onChange: (view: "diagram" | "code") => void;
	toggleId: string;
}) {
	return (
		<div
			role="tablist"
			className="inline-flex gap-1 rounded-md border border-border-default bg-surface-sunken p-[3px]"
		>
			{(
				[
					{ value: "diagram", icon: "image" },
					{ value: "code", icon: "code" },
				] as const
			).map((option) => (
				<button
					key={option.value}
					type="button"
					role="tab"
					aria-selected={view === option.value}
					onClick={() => onChange(option.value)}
					className={
						"relative inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 font-sans text-[length:var(--size-xs)] leading-none capitalize transition-colors " +
						(view === option.value
							? "font-semibold text-text-heading"
							: "font-medium text-text-subtle hover:text-text-heading")
					}
				>
					{view === option.value ? (
						<motion.span
							layoutId={`${toggleId}-pill`}
							transition={TRANSITIONS.snap}
							className="absolute inset-0 rounded-sm border border-border-default bg-surface-card shadow-xs"
						/>
					) : null}
					<span className="relative z-10 inline-flex items-center gap-1.5">
						<Icon name={option.icon} size={12} />
						{option.value}
					</span>
				</button>
			))}
		</div>
	);
}

const PRE_CLASS =
	"font-mono font-normal leading-[1.62] text-[length:var(--size-sm)] text-code-fg overflow-x-auto";

const THEME_NAME = "mdxserve-tokens";

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;

/** Plain lines, before (or without) highlighting. */
function plainLines(code: string): HighlightedLine[] {
	return code.split("\n").map((line) => [{ content: line }]);
}

function useHighlightedLines(lang: string | null, code: string): HighlightedLine[] {
	const [state, setState] = useState(() => ({
		lang,
		code,
		lines: cachedHighlight(lang, code) ?? plainLines(code),
	}));
	const current =
		state.lang === lang && state.code === code
			? state.lines
			: (cachedHighlight(lang, code) ?? plainLines(code));
	useEffect(() => {
		let cancelled = false;
		void highlight(lang, code)
			.then((lines) => {
				if (!cancelled && lines) setState({ lang, code, lines });
			})
			.catch(() => {
				// No grammar, or the chunk failed to load: the plain lines stay.
			});
		return () => {
			cancelled = true;
		};
	}, [lang, code]);
	return current;
}

/** The `<pre>` of a code block, with one `<span data-line>` per line. */
function CodeLines({
	lang,
	value,
	showLineNumbers,
	highlightLines,
}: {
	lang: string | null;
	value: string;
	showLineNumbers: boolean;
	highlightLines: readonly number[];
}) {
	const lines = useHighlightedLines(lang, value);
	const highlighted = new Set(highlightLines);
	const language = lang ?? "plaintext";
	return (
		<pre
			data-language={language}
			data-theme={THEME_NAME}
			data-code-source
			tabIndex={0}
			className={PRE_CLASS}
		>
			<code
				data-language={language}
				data-theme={THEME_NAME}
				data-line-numbers={showLineNumbers ? "" : undefined}
				data-line-numbers-max-digits={showLineNumbers ? String(lines.length).length : undefined}
				style={{ display: "grid" }}
			>
				{lines.map((tokens, index) => (
					<LineSpan
						key={index}
						tokens={tokens}
						highlighted={highlighted.has(index + 1)}
						last={index === lines.length - 1}
					/>
				))}
			</code>
		</pre>
	);
}

function LineSpan({
	tokens,
	highlighted,
	last,
}: {
	tokens: HighlightedLine;
	highlighted: boolean;
	last: boolean;
}) {
	const empty = tokens.every((token) => token.content === "");
	return (
		<>
			<span data-line="" data-highlighted-line={highlighted ? "" : undefined}>
				{empty
					? // An empty line keeps its height in the grid.
						" "
					: tokens.map((token, index) =>
							token.color === undefined && !token.fontStyle ? (
								token.content
							) : (
								<span
									key={index}
									style={{
										color: token.color,
										fontStyle:
											token.fontStyle && token.fontStyle & FONT_STYLE_ITALIC ? "italic" : undefined,
										fontWeight:
											token.fontStyle && token.fontStyle & FONT_STYLE_BOLD ? "bold" : undefined,
										textDecoration:
											token.fontStyle && token.fontStyle & FONT_STYLE_UNDERLINE
												? "underline"
												: undefined,
									}}
								>
									{token.content}
								</span>
							),
						)}
			</span>
			{last ? null : "\n"}
		</>
	);
}

/**
 * Shared card: header bar (label + actions) over the code, or for a mermaid
 * block a diagram/code toggle over the rendered diagram and its source.
 * Content rises with the rest of the prose column, so the frame itself has no
 * entrance animation of its own.
 */
function CodeFrame({
	title,
	language,
	source,
	onEditDiagram,
	children,
}: {
	title?: string;
	language?: string;
	/** The block's text, for the copy button and the diagram. */
	source: string;
	/** Opens the diagram editor; absent where the reader may not edit. */
	onEditDiagram?: () => void;
	children: ReactNode;
}) {
	const isMermaid = language === "mermaid";
	const [view, setView] = useState<"diagram" | "code">("diagram");
	const label = title ?? language;
	const showDiagram = isMermaid && view === "diagram";
	const toggleId = useId();

	// A flow-direction choice is a view setting, not an edit: it is applied to
	// the text handed to mermaid and nowhere else. Remembering which source it
	// was chosen for means a re-render with new content (the file was saved with
	// a different header) falls back to the default automatically.
	const wideScreen = useMediaQuery(DESKTOP_MEDIA, true);
	const authored = isMermaid ? readFlowchartDirection(source) : null;
	// A left-to-right chart is wider than a phone column, so narrow screens start
	// it top-down; vertical charts already fit and keep the author's direction.
	const preferred =
		authored !== null && !wideScreen && (authored === "LR" || authored === "RL") ? "TB" : authored;
	const [chosen, setChosen] = useState<{ source: string; direction: FlowDirection } | null>(null);
	const direction = chosen !== null && chosen.source === source ? chosen.direction : preferred;
	const diagramSource = direction !== null ? setFlowchartDirection(source, direction) : source;
	const directionMenu =
		authored !== null && direction !== null ? (
			<DirectionMenu
				value={direction}
				authored={authored}
				onChange={(next) => setChosen({ source, direction: next })}
			/>
		) : null;

	return (
		<div
			data-mermaid-editable={isMermaid ? "" : undefined}
			className="overflow-hidden rounded-lg border border-code-border bg-code-bg"
		>
			<CodeFrameHeader
				label={label}
				actions={
					<>
						{isMermaid ? <ViewToggle view={view} onChange={setView} toggleId={toggleId} /> : null}
						{showDiagram ? directionMenu : null}
						{isMermaid && onEditDiagram && (
							<button
								type="button"
								aria-label="Edit diagram"
								data-print-hide
								className="inline-flex items-center gap-1.5 text-[length:var(--size-xs)] text-text-subtle hover:text-text-heading"
								onClick={onEditDiagram}
							>
								<Icon name="pencil" size={12} />
								Edit
							</button>
						)}

						<CopyButton getText={() => source} />
					</>
				}
			/>
			{isMermaid ? (
				<CrossFade
					active={showDiagram ? "diagram" : "code"}
					panes={[
						{
							key: "diagram",
							node: <MermaidDiagram source={diagramSource} toolbar={directionMenu} />,
						},
						{ key: "code", node: children },
					]}
				/>
			) : (
				children
			)}
		</div>
	);
}

export interface CodeBlockProps {
	lang: string | null;
	title: string | null;
	showLineNumbers: boolean;
	/** 1-based lines to highlight. */
	highlightLines: readonly number[];
	value: string;
	/** Mermaid only: opens the diagram editor. */
	onEditDiagram?: () => void;
}

/** A code node of the document tree: the framed, highlighted block, or a mermaid diagram. */
export function CodeBlock({
	lang,
	title,
	showLineNumbers,
	highlightLines,
	value,
	onEditDiagram,
}: CodeBlockProps) {
	return (
		<CodeFrame
			title={title ?? undefined}
			language={lang ?? undefined}
			source={value}
			onEditDiagram={onEditDiagram}
		>
			<CodeLines
				lang={lang}
				value={value}
				showLineNumbers={showLineNumbers}
				highlightLines={highlightLines}
			/>
		</CodeFrame>
	);
}
