import {
	Children,
	createContext,
	isValidElement,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
	type ComponentPropsWithoutRef,
	type ReactElement,
	type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MermaidDiagram } from "./Mermaid";
import { T } from "./motion";
import { CrossFade } from "./CrossFade";
import { Icon } from "./ui/Icon";

/**
 * Code block chrome for MDX-compiled output, styled from the design tokens
 * (bg-code-bg / border-code-border / text-code-fg — see client/design/tokens/colors.css).
 *
 * rehype-pretty-code (node_modules/rehype-pretty-code/dist/index.js) wraps every fenced
 * code block as:
 *
 *   <figure data-rehype-pretty-code-figure>                                  // index.js:459
 *     <figcaption data-rehype-pretty-code-title                              // index.js:506-510
 *                  data-language data-theme>title</figcaption>               // only when `title="…"` meta is set
 *     <pre data-language data-theme>                                        // index.js:478-479
 *       <code data-language data-theme style="display:grid"                 // index.js:483-484, 495-498
 *             data-line-numbers?                                            // index.js:748, set on <code> when `showLineNumbers` meta present
 *             data-line-numbers-max-digits?>                                // index.js:499-500
 *         <span data-line data-highlighted-line?>…</span>                   // index.js:459(line loop)/766, "line" class -> data-line, {n,m-n} meta -> data-highlighted-line
 *       </code>
 *     </pre>
 *   </figure>
 *
 * We intercept both `figure` and `pre` in the MDXProvider components map (see
 * client/entry.tsx). `Figure` renders the framed card (header bar + copy button)
 * for processed code figures, pulling the title out of the figcaption and the
 * language off the `pre`; `Pre` then renders as a bare, styled `<pre>` inside
 * that card. A `<pre>` that is *not* inside one of our `Figure`s (e.g.
 * hand-written JSX in an .mdx file, which bypasses rehype-pretty-code entirely)
 * falls back to rendering the same card itself, so plain `<pre>` still looks right.
 * `CodeFrame` is the single source of truth for that card, used by both paths;
 * `CodeFrameHeader` is its header bar, exported standalone so other framed
 * code-like surfaces (e.g. the Diff builtin) can reuse the same chrome.
 */

const InsideCodeFrame = createContext(false);

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
			transition={T.snap}
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
					transition={T.fast}
					className="inline-flex items-center gap-1.5"
				>
					<Icon name={copied ? "check" : "copy"} size={13} />
					{copied ? "Copied" : "Copy"}
				</motion.span>
			</AnimatePresence>
		</motion.button>
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
							transition={T.snap}
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

/**
 * Shared card: header bar (label + actions) wrapping whatever `<pre>` is
 * passed as children. Copies via a ref instead of prop-drilling so it works
 * whether the `<pre>` came from `Figure` or was rendered directly by `Pre`.
 * Content rises with the rest of the prose column, so the frame itself has no
 * entrance animation of its own.
 */
function CodeFrame({
	title,
	language,
	children,
}: {
	title?: string;
	language?: string;
	children: ReactNode;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const isMermaid = language === "mermaid";
	const [view, setView] = useState<"diagram" | "code">("diagram");
	const [source, setSource] = useState<string | null>(null);
	const label = title ?? language;
	const showDiagram = isMermaid && view === "diagram";
	const toggleId = useId();

	// Pull the raw diagram text out of the (always-mounted) <pre> so the diagram
	// view and the copy button share one source of truth.
	useEffect(() => {
		if (!isMermaid) return;
		const pre = containerRef.current?.querySelector("pre");
		setSource(pre?.textContent ?? "");
	}, [isMermaid, children]);

	function getCopyText() {
		return containerRef.current?.querySelector("pre")?.textContent ?? "";
	}

	return (
		<div
			ref={containerRef}
			className="overflow-hidden rounded-lg border border-code-border bg-code-bg"
		>
			<CodeFrameHeader
				label={label}
				actions={
					<>
						{isMermaid ? <ViewToggle view={view} onChange={setView} toggleId={toggleId} /> : null}
						<CopyButton getText={getCopyText} />
					</>
				}
			/>
			{isMermaid ? (
				<CrossFade
					active={showDiagram ? "diagram" : "code"}
					panes={[
						{ key: "diagram", node: source !== null ? <MermaidDiagram source={source} /> : null },
						{
							key: "code",
							node: <InsideCodeFrame.Provider value={true}>{children}</InsideCodeFrame.Provider>,
						},
					]}
				/>
			) : (
				<InsideCodeFrame.Provider value={true}>{children}</InsideCodeFrame.Provider>
			)}
		</div>
	);
}

const PRE_CLASS =
	"font-mono font-normal leading-[1.62] text-[length:var(--size-sm)] text-code-fg overflow-x-auto";

type PreProps = ComponentPropsWithoutRef<"pre"> & { "data-language"?: string };

/**
 * MDXProvider `pre` override. Inside a `Figure`-rendered card it's just the bare
 * styled `<pre>` (the card supplies the header/copy button); standalone, it wraps
 * itself in `CodeFrame` so it still gets the full treatment.
 */
export function Pre(props: PreProps) {
	const insideFrame = useContext(InsideCodeFrame);
	if (insideFrame) {
		return <pre {...props} className={PRE_CLASS} />;
	}
	const { "data-language": language, ...rest } = props;
	return (
		<CodeFrame language={language}>
			<pre {...rest} data-language={language} className={PRE_CLASS} />
		</CodeFrame>
	);
}

type FigureProps = ComponentPropsWithoutRef<"figure"> & {
	"data-rehype-pretty-code-figure"?: string;
};

function textContentOf(node: ReactNode): string {
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textContentOf).join("");
	if (isValidElement(node)) return textContentOf((node.props as { children?: ReactNode }).children);
	return "";
}

/**
 * MDXProvider `figure` override. Only rehype-pretty-code's code figures (tagged
 * with `data-rehype-pretty-code-figure`) get the framed treatment; any
 * other `<figure>` (e.g. wrapping an image) renders unchanged.
 */
export function Figure({ children, ...props }: FigureProps) {
	if (!("data-rehype-pretty-code-figure" in props)) {
		return <figure {...props}>{children}</figure>;
	}

	const nodes = Children.toArray(children).filter(isValidElement) as ReactElement<
		Record<string, unknown>
	>[];
	const titleNode = nodes.find((node) => "data-rehype-pretty-code-title" in node.props);
	// The figure only ever contains the optional title and the <pre>; avoid comparing
	// component identity (it changes under Fast Refresh) and take the non-title child.
	const preNode = nodes.find((node) => node !== titleNode);
	const title = titleNode ? textContentOf(titleNode) : undefined;
	const language = preNode ? (preNode.props["data-language"] as string | undefined) : undefined;

	return (
		<CodeFrame title={title} language={language}>
			{preNode}
		</CodeFrame>
	);
}
