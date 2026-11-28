import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	Alert,
	Linking,
	processColor,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import { useResolveClassNames } from "uniwind";
import type { AnchorFields } from "@mdxserve/client/comments/anchor";
import type { TextMark } from "@mdxserve/client/comments/marks";
import type { TreeBlocks } from "@mdxserve/client/comments/tree-blocks";
import type { InlineNode } from "@mdxserve/client/document/tree-types";
import { CommentMarksContext, type CommentMarks } from "@mdxserve/ui/document/comment-marks";
import { useDocumentEnvironment } from "@mdxserve/ui/document/environment";
import {
	CODE_BACKGROUND,
	CODE_SIZE,
	CODE_TEXT,
	FOOTNOTE,
	LINK,
	MARK,
	MARK_ACTIVE,
	STRONG,
	type SelectableBlockProps,
} from "@mdxserve/ui/document/text-runs";
import { SelectableTextView } from "../../modules/selectable-text";
import { anchorFromSelection, blockRuns, runActions } from "./block-runs";
import { layoutStyle, nativeRuns, type RunTheme } from "./native-runs";

/** What a document's selectable blocks need from the document: its blocks, and how to start a thread. */
export interface DocumentSelection {
	blocks: TreeBlocks | null;
	/** Opens a new thread on the selected text; null where the reader may not write (a restricted server). */
	startThread: ((anchor: AnchorFields) => void) | null;
	/** Told each block's two heights: the `Text` layout's and the native text's (the gallery's selection check). */
	onHeights?: (block: object, heights: { layout: number; native: number }) => void;
	/** TEMPORARY K-gate diagnostics: the native view's report of what it received and drew. */
	onDiagnostics?: (block: object, report: Record<string, unknown>) => void;
}

export const DocumentSelectionContext = createContext<DocumentSelection | null>(null);

/** The selection menu's item that starts a thread. */
const COMMENT = "Comment";

const NO_SUBSCRIBE: CommentMarks["subscribe"] = () => () => {};

/** The marks on a block's text nodes and the active thread, as `blockRuns` reads them. */
interface BlockMarks {
	marks: ReadonlyMap<object, readonly TextMark[] | undefined>;
	active: string | null;
}

const NO_MARKS: BlockMarks = { marks: new Map(), active: null };

/**
 * The marks on a block's text nodes and the active thread, as one value that changes only when
 * one of them does, so the block redraws only then.
 */
function useBlockMarks(
	context: CommentMarks | null,
	sources: readonly (object | null)[] | undefined,
): BlockMarks {
	const last = useRef<BlockMarks>(NO_MARKS);
	return useSyncExternalStore(context?.subscribe ?? NO_SUBSCRIBE, () => {
		if (!context || !sources) return NO_MARKS;
		const previous = last.current;
		const marks = new Map<object, readonly TextMark[] | undefined>();
		let same = previous.active === context.activeThread();
		for (const source of sources) {
			if (!source) continue;
			const list = context.marksOf(source);
			marks.set(source, list);
			if (previous.marks.get(source) !== list || !previous.marks.has(source)) same = false;
		}
		if (same && previous.marks.size === marks.size) return previous;
		last.current = { marks, active: context.activeThread() };
		return last.current;
	});
}

function colorOf(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const processed = processColor(value);
	return typeof processed === "number" ? processed : null;
}

/** A number from the stylesheet, which may give a weight as a string ("600"). */
function numberOf(value: unknown, fallback: number): number {
	const number = typeof value === "string" ? Number(value) : value;
	return typeof number === "number" && Number.isFinite(number) ? number : fallback;
}

/** The look of every kind of run in a block whose text is drawn in `text`'s classes, or null until the stylesheet answers. */
function useRunTheme(text: string): RunTheme | null {
	const base = useResolveClassNames(text);
	const strong = useResolveClassNames(STRONG);
	const link = useResolveClassNames(LINK);
	const code = useResolveClassNames(`${CODE_TEXT} ${CODE_SIZE}`);
	const codeBackground = useResolveClassNames(CODE_BACKGROUND);
	const footnote = useResolveClassNames(FOOTNOTE);
	const mark = useResolveClassNames(MARK);
	const markActive = useResolveClassNames(MARK_ACTIVE);
	return useMemo(() => {
		const colors = {
			base: colorOf(base.color),
			strong: colorOf(strong.color),
			link: colorOf(link.color),
			code: colorOf(code.color),
			codeBackground: colorOf(codeBackground.backgroundColor),
			mark: colorOf(mark.backgroundColor),
			markActive: colorOf(markActive.backgroundColor),
		};
		const fontSize = base.fontSize;
		const lineHeight = base.lineHeight;
		if (
			Object.values(colors).some((color) => color === null) ||
			typeof fontSize !== "number" ||
			typeof lineHeight !== "number" ||
			typeof base.fontFamily !== "string" ||
			typeof code.fontFamily !== "string"
		)
			return null;
		return {
			base: {
				fontFamily: base.fontFamily,
				fontWeight: numberOf(base.fontWeight, 400),
				fontSize,
				lineHeight,
				color: colors.base as number,
			},
			strong: { fontWeight: numberOf(strong.fontWeight, 600), color: colors.strong as number },
			link: colors.link as number,
			code: {
				fontFamily: code.fontFamily,
				fontWeight: numberOf(code.fontWeight, 500),
				fontSize: numberOf(code.fontSize, fontSize),
				color: colors.code as number,
				background: colors.codeBackground as number,
			},
			footnoteSize: numberOf(footnote.fontSize, fontSize),
			mark: colors.mark as number,
			markActive: colors.markActive as number,
		};
	}, [base, strong, link, code, codeBackground, footnote, mark, markActive]);
}

/**
 * A block of the document as native selectable text (the development build's selectable-text
 * module): the reader selects any part of it, and the selection menu has the system's Copy and,
 * where the reader may write, Comment, which opens a new thread on the selected words. Links and
 * highlights open on a tap, as in `Text`.
 *
 * Its height comes from the same runs laid out, invisible, by a `Text` underneath, so the list
 * row has its size in the same pass as every other row and never jumps; the native view, which
 * lays the runs out with React Native's own text settings, covers it. Should the native text need
 * more room, the block grows to the height it reports. A block runs cannot draw (an image, a
 * builtin) or that is not one of the web's blocks is `fallback`, the `Text` it always was.
 */
function SelectableBlock({ block, look, fallback }: SelectableBlockProps) {
	const selection = useContext(DocumentSelectionContext);
	const marks = useContext(CommentMarksContext);
	const { openLink } = useDocumentEnvironment();
	const { fontScale } = useWindowDimensions();
	const theme = useRunTheme(look.text);
	const [twinHeight, setTwinHeight] = useState(0);
	const [nativeHeight, setNativeHeight] = useState(0);

	const blocks = selection?.blocks ?? null;
	const position = blocks?.positionOf(block);
	const treeBlock = position === undefined ? undefined : blocks?.blocks[position];
	const blockMarks = useBlockMarks(marks, treeBlock?.sources);
	const text = useMemo(() => {
		if (!treeBlock || !Array.isArray(block)) return null;
		return blockRuns(block as InlineNode[], treeBlock, {
			marksOf: (source) => blockMarks.marks.get(source),
			activeThread: blockMarks.active,
		});
	}, [block, treeBlock, blockMarks]);
	const runs = useMemo(() => (text && theme ? nativeRuns(text, theme) : null), [text, theme]);
	const actions = useMemo(() => (text ? runActions(text) : []), [text]);
	const onHeights = selection?.onHeights;
	useEffect(() => {
		onHeights?.(block, { layout: twinHeight, native: nativeHeight });
	}, [onHeights, block, twinHeight, nativeHeight]);

	if (!SelectableTextView || !blocks || position === undefined || !text || !runs || !theme)
		return fallback;
	const NativeText = SelectableTextView;
	const startThread = selection?.startThread ?? null;

	return (
		<View
			className={look.spacing}
			nativeID={look.nativeID}
			style={nativeHeight > twinHeight + 1 ? { minHeight: nativeHeight } : undefined}
			testID="selectable-block"
		>
			<Text
				aria-hidden={true}
				className={look.text}
				style={{ opacity: 0 }}
				onLayout={(event) => setTwinHeight(event.nativeEvent.layout.height)}
			>
				{runs.map((run, index) => (
					<Text key={index} style={layoutStyle(run)}>
						{run.text}
					</Text>
				))}
			</Text>
			<NativeText
				style={StyleSheet.absoluteFill}
				runs={runs}
				lineHeight={theme.base.lineHeight}
				fontScale={fontScale}
				commentTitle={startThread ? COMMENT : undefined}
				actions={actions}
				heading={look.heading !== undefined}
				onTextHeight={(event) => setNativeHeight(event.nativeEvent.height)}
				onDiagnostics={(event) => selection?.onDiagnostics?.(block, event.nativeEvent)}
				onPressRun={(event) => {
					const press = text.runs[event.nativeEvent.index]?.press;
					if (!press) return;
					if (press.kind === "mark") marks?.pressMark(press.threadIds);
					else if (press.href === "") return;
					else if (openLink) openLink(press.href);
					else void Linking.openURL(press.href);
				}}
				onComment={(event) => {
					if (!startThread) return;
					const result = anchorFromSelection(
						text,
						blocks.descriptions,
						position,
						event.nativeEvent,
					);
					if (result.kind === "ok") startThread(result.anchor);
					else Alert.alert(result.message);
				}}
			/>
		</View>
	);
}

/** The selectable block, where the native view exists (a development build); null in Expo Go. */
export const selectableBlock = SelectableTextView ? SelectableBlock : null;
