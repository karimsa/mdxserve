import { createContext, useContext, type ReactNode } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import type { ErrorNode } from "@mdxserve/client/document/tree-types";
import Kbd from "../builtins/Kbd";
import { Icon } from "../primitives/Icon";
import { Code, Heading, Link } from "../primitives/Text";
import { useDocumentEnvironment } from "./environment";

/*
 * The app's document elements: React Native views and text in the prose's type scale. A block
 * is a `View` (or a `Text` for a paragraph), and everything inline is a `Text` inside it, which
 * React Native lays out as runs of one line. The web's are elements.web.tsx.
 */

interface Children {
	children?: ReactNode;
}

const PROSE =
	"font-sans text-[length:var(--size-prose)] leading-[var(--leading-prose)] text-text-body";

export function Paragraph({ children }: Children) {
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
		<View role="listitem" className="flex-row gap-2">
			{checked === null ? (
				<Text className={`min-w-4 text-right ${PROSE} text-text-muted`}>{marker}</Text>
			) : (
				(box ?? <TaskBox checked={checked} />)
			)}
			<View className="min-w-0 flex-1">{children}</View>
		</View>
	);
}

/**
 * A task list item's box, checked or not. With `onToggle` the reader can tick it; without, it
 * shows what the file says. `disabled` greys it while another tick is being saved.
 */
export function TaskBox({
	checked,
	onToggle,
	disabled = false,
}: {
	checked: boolean;
	onToggle?: () => void;
	disabled?: boolean;
}) {
	const icon = (
		<Icon
			name={checked ? "square-check" : "square"}
			size="md"
			className={disabled ? "text-text-subtle" : "text-text-accent"}
		/>
	);
	if (!onToggle) {
		return (
			<View
				accessible={true}
				role="checkbox"
				aria-checked={checked}
				aria-disabled={true}
				className="mt-1"
			>
				{icon}
			</View>
		);
	}
	return (
		<Pressable
			role="checkbox"
			aria-checked={checked}
			aria-disabled={disabled}
			disabled={disabled}
			onPress={onToggle}
			hitSlop={8}
			className="mt-1"
		>
			{icon}
		</Pressable>
	);
}

/** A tight list item's text: one line of runs. */
export function TightText({ children }: Children) {
	return <Text className={PROSE}>{children}</Text>;
}

/** A Markdown table cell's content, in the table's type: small, the header muted. */
export function CellText({ header, children }: Children & { header: boolean }) {
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

export function InlineCode({ value }: { value: string }) {
	return <Code>{value}</Code>;
}

export function Anchor({
	href,
	onPress,
	children,
}: Children & { href: string; title: string | null; onPress?: () => void }) {
	return (
		<Link href={href} onPress={onPress}>
			{children}
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
}: Children & { level: 1 | 2 | 3 | 4 | 5 | 6; id: string; className?: string }) {
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
