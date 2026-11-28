import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import { Check } from "lucide-react-native/icons";
import { Animated, Image, Pressable, ScrollView, Text, View } from "react-native";
import { useResolveClassNames } from "uniwind";
import { splitByMarks, type TextMark } from "@mdxserve/client/comments/marks";
import type { ErrorNode } from "@mdxserve/client/document/tree-types";
import Kbd from "../builtins/Kbd";
import { Heading, Link } from "../primitives/Text";
import { SPRINGS } from "../tokens/springs";
import { CommentMarksContext, type CommentMarks } from "./comment-marks";
import { useDocumentEnvironment } from "./environment";

/*
 * The app's document elements: React Native views and text in the prose's type scale. A block
 * is a `View` (or a `Text` for a paragraph), and everything inline is a `Text` inside it, which
 * React Native lays out as runs of one line. The web's are elements.web.tsx.
 */

interface Children {
	children?: ReactNode;
}

/** The block a text element draws (nodes.tsx passes it), for the comment features that need it. */
interface Block {
	block?: object;
}

const PROSE =
	"font-sans text-[length:var(--size-prose)] leading-[var(--leading-prose)] text-text-body";

export function Paragraph({ children }: Children & Block) {
	return <Text className={`my-2 ${PROSE}`}>{children}</Text>;
}

export function Blockquote({ children }: Children) {
	return <View className="my-2 border-l-2 border-border-strong pl-4">{children}</View>;
}

/** Whether a list is numbered, and its first number, for the items inside it. */
const ListContext = createContext<{ ordered: boolean; start: number } | null>(null);
/** The item's position in its list, for its number. */
const ItemIndexContext = createContext(0);

export function List({
	ordered,
	start,
	children,
}: Children & { ordered: boolean; start: number | null }) {
	const items = Array.isArray(children) ? children : [children];
	return (
		<ListContext value={{ ordered, start: start ?? 1 }}>
			<View role="list" className="my-2 gap-1">
				{items.map((item, index) => (
					<ItemIndexContext key={index} value={index}>
						{item}
					</ItemIndexContext>
				))}
			</View>
		</ListContext>
	);
}

/**
 * A list item: its marker (a bullet, a number, or a task item's checkbox) in a column of its
 * own, beside the item's content, whose blocks (paragraphs, a nested list) stack one under
 * another.
 */
export function ListItem({
	checked,
	box,
	children,
}: Children & { checked: boolean | null; box?: ReactNode }) {
	const list = useContext(ListContext);
	const index = useContext(ItemIndexContext);
	const marker = list?.ordered ? `${list.start + index}.` : "•";
	return (
		<View role="listitem" className={`flex-row ${checked === null ? "gap-2" : "gap-3"}`}>
			{checked === null ? (
				<Text className={`min-w-4 text-right ${PROSE} text-text-muted`}>{marker}</Text>
			) : (
				(box ?? <TaskBox checked={checked} />)
			)}
			<View className="min-w-0 flex-1">{children}</View>
		</View>
	);
}

/** The prose's line height, in points: a task box is centred on the first line of its item. */
function useProseLineHeight(): number {
	const { lineHeight } = useResolveClassNames(PROSE);
	return typeof lineHeight === "number" ? lineHeight : FALLBACK_LINE_HEIGHT;
}

/** 16.5 pt × 1.72, the `--size-prose` and `--leading-prose` tokens, until the stylesheet answers. */
const FALLBACK_LINE_HEIGHT = 28;
/** The box's side, about the height of the prose's capitals plus their descenders. */
const BOX = 20;
/** Enough room around the box for a 44 pt touch target, without moving anything. */
const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

/**
 * A task list item's checkbox, drawn like the web's: a rounded box with a visible border when
 * unchecked, filled with the accent and a white check when checked. It sits in the list's marker
 * column, centred on the item's first line. With `onToggle` the reader can tick it, and the box
 * settles in with the controls' snap spring; without, it shows what the file says. `disabled`
 * (a read-only server, or another tick being saved) dims it and leaves it untouchable. `label` is
 * what VoiceOver reads with its state: the item's text.
 */
export function TaskBox({
	checked,
	onToggle,
	disabled = false,
	label,
}: {
	checked: boolean;
	onToggle?: () => void;
	disabled?: boolean;
	label?: string;
}) {
	const lineHeight = useProseLineHeight();
	const { color: checkColor } = useResolveClassNames("text-n-25");
	const scale = useRef(new Animated.Value(1)).current;
	const shown = useRef(checked);
	useEffect(() => {
		if (shown.current === checked) return;
		shown.current = checked;
		scale.setValue(0.82);
		Animated.spring(scale, { toValue: 1, ...SPRINGS.snap, useNativeDriver: true }).start();
	}, [checked, scale]);
	// The classes go on a plain view: Uniwind styles React Native's own components, and the
	// animated wrapper only scales.
	const box = (
		<Animated.View style={{ transform: [{ scale }] }}>
			<View
				style={{ width: BOX, height: BOX }}
				className={`items-center justify-center rounded-sm ${checked ? "bg-surface-accent" : "border-2 border-text-subtle"} ${disabled ? "opacity-50" : ""}`}
			>
				{checked ? (
					<Check
						size={14}
						strokeWidth={3}
						color={typeof checkColor === "string" ? checkColor : undefined}
						aria-hidden={true}
					/>
				) : null}
			</View>
		</Animated.View>
	);
	const column = { height: lineHeight, width: BOX };
	if (!onToggle) {
		return (
			<View
				accessible={true}
				role="checkbox"
				aria-checked={checked}
				aria-disabled={true}
				accessibilityLabel={label}
				style={column}
				className="justify-center"
			>
				{box}
			</View>
		);
	}
	return (
		<Pressable
			role="checkbox"
			aria-checked={checked}
			aria-disabled={disabled}
			accessibilityLabel={label}
			disabled={disabled}
			onPress={onToggle}
			hitSlop={HIT_SLOP}
			style={column}
			className="justify-center"
		>
			{box}
		</Pressable>
	);
}

/** A tight list item's text: one line of runs. */
export function TightText({ children }: Children & Block) {
	return <Text className={PROSE}>{children}</Text>;
}

/** A Markdown table cell's content, in the table's type: small, the header muted. */
export function CellText({ header, children }: Children & Block & { header: boolean }) {
	return (
		<Text
			className={`font-sans leading-normal ${header ? "text-[length:var(--size-xs)] font-semibold text-text-muted" : "text-[length:var(--size-sm)] text-text-body"}`}
		>
			{children}
		</Text>
	);
}

/** A run of inline nodes among a container's blocks: one line of prose. */
export function InlineRun({ children }: Children) {
	return <Text className={`my-1 ${PROSE}`}>{children}</Text>;
}

export function Rule() {
	return <View className="my-4 h-px bg-border-default" />;
}

export function Emphasis({ children }: Children) {
	return <Text className="italic">{children}</Text>;
}

export function Strong({ children }: Children) {
	return <Text className="font-semibold text-text-heading">{children}</Text>;
}

export function Delete({ children }: Children) {
	return <Text className="line-through">{children}</Text>;
}

/**
 * A text node's characters as HTML shows them: a `Text` keeps every newline and run of spaces,
 * so a Markdown soft line break (a newline inside a paragraph) would break the line. Each run of
 * spaces, tabs and newlines becomes one space; a no-break space is kept. A hard line break is a
 * `break` node, drawn by `LineBreak`, and code keeps its own whitespace.
 */
function textOf(value: string): string {
	return value.replace(/[ \t\n\r\f]+/g, " ");
}

/** A comment highlight's background, and the active thread's (the `--comment-mark` tokens). */
const MARK = "bg-comment-mark";
const MARK_ACTIVE = "bg-comment-mark-active";

/** Inside a link a highlight does not take the press: the link keeps it. */
const InsideLinkContext = createContext(false);

const NO_MARKS: CommentMarks["subscribe"] = () => () => {};

/**
 * The comment marks on one tree node and the active thread, redrawn only when they change for
 * this node. `press` is null inside a link, or with no comment marks around the document.
 */
function useMarks(source: object | undefined): {
	marks: readonly TextMark[] | undefined;
	active: string | null;
	press: ((threadIds: readonly string[]) => void) | null;
} {
	const context = useContext(CommentMarksContext);
	const insideLink = useContext(InsideLinkContext);
	const subscribe = context?.subscribe ?? NO_MARKS;
	const marks = useSyncExternalStore(subscribe, () =>
		context && source ? context.marksOf(source) : undefined,
	);
	const active = useSyncExternalStore(subscribe, () =>
		context && marks ? context.activeThread() : null,
	);
	return {
		marks,
		active,
		press: context && !insideLink ? (threadIds) => context.pressMark(threadIds) : null,
	};
}

/** A text node: `renderText`'s output in the app. */
export function renderText(node: { value: string }): ReactNode {
	return <MarkedText source={node} value={node.value} />;
}

/**
 * A node's text with its comment highlights: each marked stretch a nested `Text` with the mark's
 * background, which taps open its thread. With no marks it is the same string `textOf` gives.
 * The marks' offsets are in `value`; each piece is collapsed on its own, which gives the same
 * text because a mark never starts or ends inside a run of whitespace. `code` keeps the value's
 * own whitespace, for inline code and code blocks.
 */
export function MarkedText({
	source,
	value,
	code = false,
}: {
	source: object;
	value: string;
	code?: boolean;
}) {
	const { marks, active, press } = useMarks(source);
	const shown = (text: string) => (code ? text : textOf(text));
	if (!marks || marks.length === 0) return shown(value);
	return (
		<>
			{splitByMarks(value.length, marks).map((piece) => {
				const text = shown(value.slice(piece.start, piece.end));
				if (piece.threadIds.length === 0) return text;
				return (
					<Text
						key={piece.start}
						className={piece.threadIds.includes(active ?? "") ? MARK_ACTIVE : MARK}
						onPress={press ? () => press(piece.threadIds) : undefined}
					>
						{text}
					</Text>
				);
			})}
		</>
	);
}

/** JetBrains Mono's descender, as a share of its size (hhea: −300 of 1000 units). */
const MONO_DESCENT = 0.3;
/** Code no longer than this, with no space in it, is drawn as a chip. */
const CHIP_LIMIT = 24;

/**
 * Inline code, sized to sit with the prose (`--size-sm`, JetBrains Mono) and never changing the
 * line height of the text around it.
 *
 * iOS draws a nested `Text`'s background over the whole line box and cannot pad or round it,
 * so a short code word with no space in it (an identifier, a flag, a short path) is a chip of
 * its own: a view inside the line, as tall as the code's own glyphs, rounded and padded like the
 * web's `<code>`. React Native sets an inline view's bottom on the line's baseline, so the chip
 * moves down by the code's descender to put its text on that baseline. Anything longer, or with
 * a space, must be able to wrap, and a view cannot: it is accent-coloured monospaced text with no
 * background, so a wrapped path never becomes a slab.
 */
export function InlineCode({ value, source }: { value: string; source?: object }) {
	const { fontSize } = useResolveClassNames(CODE_SIZE);
	const size = typeof fontSize === "number" ? fontSize : FALLBACK_CODE_SIZE;
	const { marks, active, press } = useMarks(source);
	if (value.length > CHIP_LIMIT || /\s/.test(value)) {
		return (
			<Text className={`${CODE_TEXT} ${CODE_SIZE}`}>
				{source ? <MarkedText source={source} value={value} code={true} /> : value}
			</Text>
		);
	}
	// A mark over the whole chip colours the chip, which a nested run's background cannot round.
	// Another thread's mark on part of the chip still draws its own run on top, with its press.
	const all = marks ?? [];
	const covers = (mark: TextMark) => mark.start <= 0 && mark.end >= value.length;
	const threadIds = all.filter(covers).map((mark) => mark.threadId);
	const markClass =
		threadIds.length === 0 ? null : threadIds.includes(active ?? "") ? MARK_ACTIVE : MARK;
	const runs = source !== undefined && (markClass === null || !all.every(covers));
	return (
		<View
			style={{ transform: [{ translateY: Math.round(size * MONO_DESCENT * 2) / 2 }] }}
			className={`rounded-xs px-1 ${markClass ?? "bg-code-bg-inline"}`}
		>
			<Text
				className={`${CODE_TEXT} ${CODE_SIZE}`}
				onPress={markClass && !runs && press ? () => press(threadIds) : undefined}
			>
				{runs ? <MarkedText source={source} value={value} code={true} /> : value}
			</Text>
		</View>
	);
}

const CODE_TEXT = "font-mono font-medium text-text-accent";
const CODE_SIZE = "text-[length:var(--size-sm)]";
/** `--size-sm`, until the stylesheet answers. */
const FALLBACK_CODE_SIZE = 13;

export function Anchor({
	href,
	onPress,
	children,
}: Children & { href: string; title: string | null; onPress?: () => void }) {
	return (
		<Link href={href} onPress={onPress}>
			<InsideLinkContext value={true}>{children}</InsideLinkContext>
		</Link>
	);
}

/**
 * An image at the width of the text, as tall as its aspect ratio makes it once it loads; the
 * environment's `renderImage` when it has one (the app's expo-image).
 */
export function Picture({ src, alt, title }: { src: string; alt: string; title: string | null }) {
	const { renderImage } = useDocumentEnvironment();
	if (renderImage) return renderImage({ src, alt, title });
	return (
		<Image
			source={{ uri: src }}
			alt={alt}
			accessibilityLabel={alt}
			resizeMode="contain"
			className="my-2 h-48 w-full rounded-md"
		/>
	);
}

/** A line break, as a run of text, so it is safe in a view too (a `<br>` on its own line). */
export function LineBreak() {
	return <Text>{"\n"}</Text>;
}

export function SectionHeading({
	level,
	id,
	className = "",
	children,
}: Children & Block & { level: 1 | 2 | 3 | 4 | 5 | 6; id: string; className?: string }) {
	return (
		<Heading level={level} nativeID={id} className={`mt-6 mb-2 ${className}`}>
			{children}
		</Heading>
	);
}

export function FootnoteRef({
	number,
}: {
	id: string;
	target: string;
	describedBy: string;
	number: number | undefined;
}) {
	return (
		<Text className="text-[length:var(--size-xs)] text-text-link">{`[${number ?? "?"}]`}</Text>
	);
}

/** Phrasing elements a document may write, by how the app draws their text. */
const PHRASING: Record<string, string> = {
	b: "font-semibold text-text-heading",
	strong: "font-semibold text-text-heading",
	i: "italic",
	em: "italic",
	u: "underline",
	s: "line-through",
	mark: "bg-status-warn-bg",
	small: "text-[length:var(--size-sm)]",
	sub: "text-[length:var(--size-xs)]",
	sup: "text-[length:var(--size-xs)]",
	abbr: "underline decoration-dotted",
	span: "",
	summary: "font-semibold",
};

/**
 * One of the lowercase elements a document may write, drawn with what React Native has: text
 * styles for the phrasing ones, a key cap for `kbd`, views for `details` and the table parts
 * (a table is laid out one row under another, and scrolls sideways when wider than the screen). An image is drawn like a Markdown image.
 */
export function RawElement({
	tag,
	props,
	onPress,
	children,
}: {
	tag: string;
	props: Record<string, unknown>;
	/** For an `<a>`: what pressing it does, as for a Markdown link (`Anchor`). */
	onPress?: () => void;
	children?: ReactNode;
}) {
	if (tag === "br") return <LineBreak />;
	if (tag === "a")
		return typeof props.href === "string" ? (
			<Anchor href={props.href} title={null} onPress={onPress}>
				{children}
			</Anchor>
		) : (
			// An anchor with nowhere to go is its text, and does nothing when pressed.
			<Text>{children}</Text>
		);
	if (tag === "img")
		return <Picture src={String(props.src ?? "")} alt={String(props.alt ?? "")} title={null} />;
	if (tag === "kbd") return <Kbd>{children}</Kbd>;
	if (tag in PHRASING) return <Text className={PHRASING[tag]}>{children}</Text>;
	// A table scrolls sideways in its own box, so a wide one never widens a narrow screen.
	if (tag === "table")
		return (
			<ScrollView horizontal={true} className="my-2">
				<View>{children}</View>
			</ScrollView>
		);
	if (tag === "tr") return <View className="flex-row gap-4">{children}</View>;
	if (tag === "td" || tag === "th")
		return <Text className={`${PROSE} ${tag === "th" ? "font-semibold" : ""}`}>{children}</Text>;
	// Only the elements whose children are blocks (`nodes.tsx` gives them a line of text for any
	// bare run) are views; anything else is text, so a string never lands in a view.
	if (BLOCK_TAGS.has(tag)) return <View className="my-1">{children}</View>;
	return <Text>{children}</Text>;
}

/** The elements drawn as a view of blocks, besides `table` and `tr`. */
const BLOCK_TAGS = new Set(["details", "thead", "tbody"]);

export function FailedSection({ node }: { node: ErrorNode }) {
	return (
		<View
			nativeID={node.id}
			role="alert"
			className="my-2 rounded border border-status-danger-fg/30 bg-status-danger-bg p-4"
		>
			<Text className="mb-2 font-sans font-semibold text-[length:var(--size-sm)] text-status-danger-fg">
				{`This section could not be read: ${node.message}`}
			</Text>
			<Text className="font-mono text-[length:var(--size-xs)] text-status-danger-fg">
				{node.source}
			</Text>
		</View>
	);
}

export function Placeholder({ text, inline }: { text: string; inline: boolean }) {
	if (inline) return <Text className="text-text-subtle">{`[${text}]`}</Text>;
	return (
		<View className="my-2 rounded border border-dashed border-border-default p-3">
			<Text className="font-sans text-[length:var(--size-sm)] text-text-subtle">{text}</Text>
		</View>
	);
}
