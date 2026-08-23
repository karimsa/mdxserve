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
import { enterTransition, fadeSwap } from "./motion";
import { CrossFade } from "./CrossFade";

/**
 * Tailwind Plus-style code block chrome for MDX-compiled output.
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
 * client/entry.tsx). `Figure` renders the Tailwind Plus dark card (header bar +
 * copy button) for processed code figures, pulling the title out of the figcaption
 * and the language off the `pre`; `Pre` then renders as a bare, styled `<pre>`
 * inside that card. A `<pre>` that is *not* inside one of our `Figure`s (e.g.
 * hand-written JSX in an .mdx file, which bypasses rehype-pretty-code entirely)
 * falls back to rendering the same card itself, so plain `<pre>` still looks right.
 * `CodeFrame` is the single source of truth for that card, used by both paths.
 */

const InsideCodeFrame = createContext(false);

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M5.5 3h5A1.5 1.5 0 0 1 12 4.5v8a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 12.5v-8A1.5 1.5 0 0 1 5.5 3Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M6.25 3V2a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Shared Tailwind Plus card: rounded dark header bar with a title/language label
 * and an always-visible copy button, wrapping whatever `<pre>` is passed as
 * children. Copies via a ref instead of prop-drilling so it works whether the
 * `<pre>` came from `Figure` or was rendered directly by `Pre`.
 */
function CodeFrame({ title, language, children }: { title?: string; language?: string; children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
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

  async function handleCopy() {
    const pre = containerRef.current?.querySelector("pre");
    const text = pre?.textContent ?? "";
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
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={enterTransition}
      className="not-prose my-6 overflow-hidden rounded-xl bg-gray-950 shadow-md ring-1 ring-white/10"
    >
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
        <span className="text-xs font-medium text-gray-400">{label}</span>
        <div className="flex items-center gap-3">
          {isMermaid ? (
            <div role="tablist" className="inline-flex rounded-md bg-white/5 p-0.5 text-xs">
              {(["diagram", "code"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={view === option}
                  onClick={() => setView(option)}
                  className={
                    "relative cursor-pointer rounded px-2 py-0.5 capitalize transition-colors " +
                    (view === option ? "text-white" : "text-gray-400 hover:text-white")
                  }
                >
                  {view === option ? (
                    <motion.span
                      layoutId={`${toggleId}-pill`}
                      transition={enterTransition}
                      className="absolute inset-0 rounded bg-white/10"
                    />
                  ) : null}
                  <span className="relative">{option}</span>
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-white"
          >
            {copied ? <CheckIcon /> : <ClipboardIcon />}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={copied ? "copied" : "copy"} variants={fadeSwap} initial="initial" animate="enter" exit="exit">
                {copied ? "Copied" : "Copy"}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </div>
      {isMermaid ? (
        <CrossFade
          active={showDiagram ? "diagram" : "code"}
          panes={[
            { key: "diagram", node: source !== null ? <MermaidDiagram source={source} /> : null },
            { key: "code", node: <InsideCodeFrame.Provider value={true}>{children}</InsideCodeFrame.Provider> },
          ]}
        />
      ) : (
        <InsideCodeFrame.Provider value={true}>{children}</InsideCodeFrame.Provider>
      )}
    </motion.div>
  );
}

const PRE_CLASS = "overflow-x-auto p-4 font-mono text-[13px] leading-6 text-gray-300";

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
 * with `data-rehype-pretty-code-figure`) get the Tailwind Plus treatment; any
 * other `<figure>` (e.g. wrapping an image) renders unchanged.
 */
export function Figure({ children, ...props }: FigureProps) {
  if (!("data-rehype-pretty-code-figure" in props)) {
    return <figure {...props}>{children}</figure>;
  }

  const nodes = Children.toArray(children).filter(isValidElement) as ReactElement<Record<string, unknown>>[];
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
