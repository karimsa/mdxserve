import { createElement, type ReactNode } from "react";
import { motion, useAnimationControls } from "framer-motion";
import type { ErrorNode } from "@mdxserve/client/document/tree-types";

/*
 * The web's document elements: the HTML the document's Markdown means, which the client's
 * prose stylesheet (`.mdx-prose`) styles and the comment anchoring reads. The app's are
 * elements.tsx. nodes.tsx decides which one a node gets; these only draw it.
 */

interface Children {
	children?: ReactNode;
}

/** The block a text element draws, for the app's comment marks; the web ignores it. */
interface Block {
	block?: object;
}

export function Paragraph({ children }: Children & Block) {
	return <p>{children}</p>;
}

export function Blockquote({ children }: Children) {
	return <blockquote>{children}</blockquote>;
}

export function List({
	ordered,
	start,
	children,
}: Children & { ordered: boolean; start: number | null }) {
	return ordered ? (
		<ol start={start === null || start === 1 ? undefined : start}>{children}</ol>
	) : (
		<ul>{children}</ul>
	);
}

/** A list item; a task item's checkbox comes first, beside its text. */
export function ListItem({ checked, children }: Children & { checked: boolean | null }) {
	return (
		<li>
			{checked === null ? null : <TaskBox checked={checked} />}
			{children}
		</li>
	);
}

/**
 * A task list item's checkbox. A plain `<input type="checkbox" disabled>` greys out and
 * swallows clicks. Swap `disabled` for `aria-disabled` so assistive tech still reports the
 * state while the box keeps its accent colour, pin the value with a no-op change handler so
 * clicking can't toggle what the Markdown says, and give a little spring bounce on click so it
 * still feels alive.
 */
function TaskBox({ checked }: { checked: boolean }) {
	const controls = useAnimationControls();
	function bounce() {
		void controls.start({
			scale: [1, 0.8, 1.2, 1],
			transition: { duration: 0.38, ease: "easeOut", times: [0, 0.25, 0.6, 1] },
		});
	}
	return (
		<motion.input
			type="checkbox"
			checked={checked}
			onChange={() => {}}
			onClick={bounce}
			aria-disabled="true"
			tabIndex={-1}
			animate={controls}
			className="origin-center"
		/>
	);
}

/** A tight list item's text, bare as a tight Markdown list renders it. */
export function TightText({ children }: Children & Block) {
	return <>{children}</>;
}

/** A Markdown table cell's content: bare inside the table's own cell. */
export function CellText({ children }: Children & Block & { header: boolean }) {
	return <>{children}</>;
}

/** A run of inline nodes among a container's blocks: bare, as the HTML always had it. */
export function InlineRun({ children }: Children) {
	return <>{children}</>;
}

export function Rule() {
	return <hr />;
}

export function Emphasis({ children }: Children) {
	return <em>{children}</em>;
}

export function Strong({ children }: Children) {
	return <strong>{children}</strong>;
}

export function Delete({ children }: Children) {
	return <del>{children}</del>;
}

/** A text node's characters: as written, since HTML collapses its own whitespace. */
export function renderText(node: { value: string }): ReactNode {
	return node.value;
}

export function InlineCode({ value }: { value: string; source?: object }) {
	return <code>{value}</code>;
}

/** A link: the browser follows it (and the client's router catches it), unless `onPress` does. */
export function Anchor({
	href,
	title,
	onPress,
	children,
}: Children & { href: string; title: string | null; onPress?: () => void }) {
	return (
		<a
			href={href === "" ? undefined : href}
			title={title ?? undefined}
			onClick={
				onPress
					? (event) => {
							event.preventDefault();
							onPress();
						}
					: undefined
			}
		>
			{children}
		</a>
	);
}

export function Picture({ src, alt, title }: { src: string; alt: string; title: string | null }) {
	return <img src={src} alt={alt} title={title ?? undefined} />;
}

export function LineBreak() {
	return <br />;
}

/**
 * A section heading. Its `id` is the section's id in the document tree, which is also its URL
 * anchor. h2 to h4 get the hover affordance that links to it (`.mdx-anchor`, styled and
 * positioned by apps/web/src/design/base/prose.css — it only shows on heading hover or focus).
 */
export function SectionHeading({
	level,
	id,
	className,
	children,
}: Children & Block & { level: 1 | 2 | 3 | 4 | 5 | 6; id: string; className?: string }) {
	const Tag = `h${level}` as const;
	return (
		<Tag id={id} className={className}>
			{children}
			{level >= 2 && level <= 4 ? (
				<a className="mdx-anchor" href={"#" + id} aria-label="Link to this section">
					#
				</a>
			) : null}
		</Tag>
	);
}

/** A footnote reference: its number, linking to the footnote. */
export function FootnoteRef({
	id,
	target,
	describedBy,
	number,
}: {
	id: string;
	target: string;
	describedBy: string;
	number: number | undefined;
}) {
	return (
		<sup>
			<a href={`#${target}`} id={id} data-footnote-ref="" aria-describedby={describedBy}>
				{number ?? "?"}
			</a>
		</sup>
	);
}

/**
 * One of the lowercase elements a document may write (`<kbd>`, `<details>`, a table part…),
 * as itself. `props` are its attributes, already renamed for React.
 */
export function RawElement({
	tag,
	props,
	onPress,
	children,
}: {
	tag: string;
	props: Record<string, unknown>;
	/** For an `<a>`: handles the click instead of the browser, as `Anchor` does. */
	onPress?: () => void;
	children?: ReactNode;
}) {
	const withPress = onPress
		? {
				...props,
				onClick: (event: { preventDefault(): void }) => {
					event.preventDefault();
					onPress();
				},
			}
		: props;
	return children === undefined
		? createElement(tag, withPress)
		: createElement(tag, withPress, children);
}

/** A section that failed to parse: the parser's message and the section's source. */
export function FailedSection({ node }: { node: ErrorNode }) {
	return (
		<div
			id={node.id}
			role="alert"
			className="not-prose rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
		>
			<p className="mb-2 font-semibold">This section could not be read: {node.message}</p>
			<pre className="whitespace-pre-wrap break-words font-mono text-xs">{node.source}</pre>
		</div>
	);
}

/** Stands in for a node this client does not know, so the rest of the document still shows. */
export function Placeholder({ text, inline }: { text: string; inline: boolean }) {
	return inline ? (
		<span data-unknown-node="" className="text-text-subtle">
			[{text}]
		</span>
	) : (
		<div
			data-unknown-node=""
			className="not-prose rounded border border-dashed border-border-default p-3 text-[length:var(--size-sm)] text-text-subtle"
		>
			{text}
		</div>
	);
}
