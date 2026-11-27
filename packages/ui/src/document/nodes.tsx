import { createContext, memo, useContext, type ComponentType, type ReactNode } from "react";
import { STATEFUL_COMPONENTS } from "@mdxserve/shared/builtins";
import type {
	BlockNode,
	ComponentNode,
	ElementNode,
	InlineNode,
	SectionNode,
	TabsNode,
	TreeNode,
} from "@mdxserve/client/document/tree-types";
import {
	Anchor,
	Blockquote,
	Delete,
	Emphasis,
	FailedSection,
	FootnoteRef,
	InlineCode,
	InlineRun,
	LineBreak,
	List,
	ListItem,
	Paragraph,
	Picture,
	Placeholder,
	RawElement,
	Rule,
	SectionHeading,
	Strong,
	TaskBox,
	TightText,
} from "./elements";
import { useDocumentEnvironment } from "./environment";
import { MarkdownTableView } from "./MarkdownTableView";

/*
 * The document tree's node renderers, shared by the web client and the app. They decide what a
 * node is (a paragraph, a list, a builtin…) and what wraps it; `./elements` draws it, as HTML on
 * the web (elements.web.tsx) and as React Native views in the app (elements.tsx). What only
 * one client has (the section editor, Shiki, Mermaid, its Tabs selection) comes from the
 * `DocumentEnvironment` around the tree.
 */

/**
 * Where a node sits for editing: at the top of the document (`root`), inside
 * an editable section (`section`), or inside a builtin, list, quote or
 * footnote (`nested`), where nothing gets an edit wrapper of its own.
 */
type EditScope = "root" | "section" | "nested";
const EditScopeContext = createContext<EditScope>("root");

/** Inside a paragraph, heading or table cell a component or element is inline. */
const InlineContext = createContext(false);

/** The id of the generated "Footnotes" heading, as GFM names it. */
export const FOOTNOTES_ID = "footnote-label";

/** What a footnote reference needs: its footnote's number and its own place among that footnote's references. */
export interface FootnoteInfo {
	numbers: ReadonlyMap<string, number>;
	counts: ReadonlyMap<string, number>;
	occurrences: WeakMap<object, number>;
	/** The reference nodes the occurrences were counted over, in document order. */
	references: readonly object[];
}
export const FootnoteContext = createContext<FootnoteInfo>({
	numbers: new Map(),
	counts: new Map(),
	occurrences: new WeakMap(),
	references: [],
});

/**
 * The footnote element ids GFM gives a label, kept so old links still land.
 * The second and later references to one footnote get `-2`, `-3`, so each
 * back link returns to its own reference.
 */
export function footnoteIds(
	label: string,
	occurrence = 1,
): { definition: string; reference: string } {
	const safe = encodeURIComponent(label.toLowerCase());
	const suffix = occurrence > 1 ? `-${occurrence}` : "";
	return {
		definition: `user-content-fn-${safe}`,
		reference: `user-content-fnref-${safe}${suffix}`,
	};
}

/** The React key of a node: its id when it has one, else its index in the parent. */
function keyOf(node: TreeNode, index: number): string {
	const id = "id" in node ? node.id : null;
	return typeof id === "string" ? `#${id}` : `@${index}`;
}

/** The children of any node, each memoized and keyed by id or by index. */
export const NodeList = memo(function NodeList({ nodes }: { nodes: readonly TreeNode[] }) {
	return (
		<>
			{nodes.map((node, index) => (
				<NodeView key={keyOf(node, index)} node={node} />
			))}
		</>
	);
});

function InlineList({ nodes }: { nodes: readonly TreeNode[] }) {
	return (
		<InlineContext value={true}>
			<NodeList nodes={nodes} />
		</InlineContext>
	);
}

function renderInline(nodes: readonly InlineNode[]): ReactNode {
	return <InlineList nodes={nodes} />;
}

/** The node types that only ever sit in a line of text. */
const INLINE_TYPES = new Set<TreeNode["type"]>([
	"text",
	"emphasis",
	"strong",
	"delete",
	"inlineCode",
	"link",
	"image",
	"break",
	"footnoteReference",
]);

/**
 * The children of a block container (a builtin's body, a tab panel, `<details>`), which may
 * mix blocks with bare inline runs: `<Callout>Careful.</Callout>` keeps its text inline. Each run
 * of inline nodes is one `InlineRun`, a line of text in the app (React Native draws text only
 * inside a `Text`) and nothing at all on the web, so the HTML stays as it was. A builtin or
 * element joins the run it follows.
 */
function BlockChildren({ nodes }: { nodes: readonly TreeNode[] }) {
	const parts: ReactNode[] = [];
	let run: { start: number; nodes: TreeNode[] } | null = null;
	const closeRun = () => {
		if (!run) return;
		parts.push(
			<InlineRun key={`run@${run.start}`}>
				<InlineList nodes={run.nodes} />
			</InlineRun>,
		);
		run = null;
	};
	nodes.forEach((node, index) => {
		const inline =
			INLINE_TYPES.has(node.type) ||
			(run !== null && (node.type === "component" || node.type === "element"));
		if (inline) {
			run ??= { start: index, nodes: [] };
			run.nodes.push(node);
			return;
		}
		closeRun();
		parts.push(<NodeView key={keyOf(node, index)} node={node} />);
	});
	closeRun();
	return <>{parts}</>;
}

/** Builtins that draw their children inside their own text (a badge's label), as runs of it. */
const PHRASING_BUILTINS = new Set(["Badge", "Kbd", "Tooltip"]);

/** The elements whose children are blocks, so a bare run of text among them needs its own line. */
const BLOCK_ELEMENTS = new Set(["details", "table", "thead", "tbody", "tr"]);

/**
 * One node of the document tree. Memoized on the node object: TanStack
 * Query's structural sharing hands back the same object for a subtree that
 * did not change, so a refetch re-renders only what changed.
 */
const NodeView = memo(function NodeView({ node }: { node: TreeNode }) {
	switch (node.type) {
		case "section":
			return <SectionView node={node} />;
		case "preamble":
			return <EditableRun id={node.id} nodes={node.children} />;
		case "paragraph":
			return (
				<Paragraph>
					<InlineList nodes={node.children} />
				</Paragraph>
			);
		case "blockquote":
			return (
				<Blockquote>
					<Nested>
						<NodeList nodes={node.children} />
					</Nested>
				</Blockquote>
			);
		case "list":
			return <ListView node={node} />;
		case "code":
			return <CodeView node={node} />;
		case "table":
			return <MarkdownTableView node={node} renderInline={renderInline} />;
		case "thematicBreak":
			return <Rule />;
		case "tabs":
			return <TabsView node={node} />;
		case "component":
			return <ComponentView node={node} />;
		case "element":
			return <ElementView node={node} />;
		case "footnoteDefinition":
			// Listed with the other footnotes at the end of the document.
			return null;
		case "error":
			return <FailedSection node={node} />;
		case "text":
			return node.value;
		case "emphasis":
			return (
				<Emphasis>
					<NodeList nodes={node.children} />
				</Emphasis>
			);
		case "strong":
			return (
				<Strong>
					<NodeList nodes={node.children} />
				</Strong>
			);
		case "delete":
			return (
				<Delete>
					<NodeList nodes={node.children} />
				</Delete>
			);
		case "inlineCode":
			return <InlineCode value={node.value} />;
		case "link":
			return <LinkView node={node} />;
		case "image":
			return <ImageView node={node} />;
		case "break":
			return <LineBreak />;
		case "footnoteReference":
			return <FootnoteReference node={node} />;
		default:
			return <PlaceholderView what={`node type "${(node as { type?: unknown }).type}"`} />;
	}
});

function Nested({ children }: { children: ReactNode }) {
	return <EditScopeContext value="nested">{children}</EditScopeContext>;
}

/** Content the reader can edit as one block: a section's own lines, or the preamble. */
function EditableRun({
	id,
	nodes,
	heading,
}: {
	id: string;
	nodes: readonly TreeNode[];
	heading?: ReactNode;
}) {
	const scope = useContext(EditScopeContext);
	const { renderEditable } = useDocumentEnvironment();
	const content = (
		<>
			{heading}
			<NodeList nodes={nodes} />
		</>
	);
	if (scope !== "root" || !renderEditable) return content;
	return (
		<EditScopeContext value="section">
			{renderEditable({ id, kind: "section", children: content })}
		</EditScopeContext>
	);
}

/**
 * A section renders flat — its heading, then its children — so the prose
 * rhythm rules see the same siblings they always have. At the top of the
 * document it is also the unit of editing, covering the same lines the
 * server's range table gives it: a level 1 section stops at its first level 1
 * or 2 subsection, which is a unit of its own.
 */
function SectionView({ node }: { node: SectionNode }) {
	const heading = (
		<SectionHeading level={node.level} id={node.id}>
			<InlineList nodes={node.heading} />
		</SectionHeading>
	);
	if (node.level !== 1) return <EditableRun id={node.id} nodes={node.children} heading={heading} />;
	const split = node.children.findIndex((child) => child.type === "section" && child.level <= 2);
	if (split === -1) return <EditableRun id={node.id} nodes={node.children} heading={heading} />;
	return (
		<>
			<EditableRun id={node.id} nodes={node.children.slice(0, split)} heading={heading} />
			<NodeList nodes={node.children.slice(split)} />
		</>
	);
}

function ListView({ node }: { node: Extract<BlockNode, { type: "list" }> }) {
	return (
		<List ordered={node.ordered} start={node.start}>
			{node.items.map((item, index) => (
				<ListItem key={index}>
					{item.checked === null ? null : <TaskBox checked={item.checked} />}
					<Nested>
						<ListItemContent nodes={item.children} />
					</Nested>
				</ListItem>
			))}
		</List>
	);
}

/**
 * A list item's paragraphs show as bare text, the way a tight Markdown list
 * renders, so a task item's checkbox stays beside its text.
 */
function ListItemContent({ nodes }: { nodes: readonly BlockNode[] }) {
	// Two paragraphs in one item make it loose: they keep their own boxes.
	const tight = nodes.filter((child) => child.type === "paragraph").length <= 1;
	return (
		<>
			{nodes.map((child, index) =>
				tight && child.type === "paragraph" ? (
					<TightText key={keyOf(child, index)}>
						<InlineList nodes={child.children} />
					</TightText>
				) : (
					<NodeView key={keyOf(child, index)} node={child} />
				),
			)}
		</>
	);
}

function CodeView({ node }: { node: Extract<BlockNode, { type: "code" }> }) {
	return useDocumentEnvironment().renderCode(node);
}

function LinkView({ node }: { node: Extract<InlineNode, { type: "link" }> }) {
	const { openLink } = useDocumentEnvironment();
	return (
		<Anchor
			href={node.href}
			title={node.title}
			onPress={openLink && node.href !== "" ? () => openLink(node.href) : undefined}
		>
			<NodeList nodes={node.children} />
		</Anchor>
	);
}

function ImageView({ node }: { node: Extract<InlineNode, { type: "image" }> }) {
	const { assetUrl } = useDocumentEnvironment();
	return <Picture src={assetUrl(node.src)} alt={node.alt} title={node.title} />;
}

/** A block builtin inside the document body gets an edit pencil of its own. */
function BlockEditWrapper({ id, children }: { id: string | null; children: ReactNode }) {
	const scope = useContext(EditScopeContext);
	const inline = useContext(InlineContext);
	const { renderEditable } = useDocumentEnvironment();
	if (id === null || inline || scope === "nested" || !renderEditable)
		return <Nested>{children}</Nested>;
	return renderEditable({ id, kind: "block", children: <Nested>{children}</Nested> });
}

function TabsView({ node }: { node: TabsNode }) {
	const { ErrorBoundary, renderTabs } = useDocumentEnvironment();
	return (
		<BlockEditWrapper id={node.id}>
			<ErrorBoundary resetKey={node}>
				{renderTabs({
					id: node.id,
					defaultValue: node.defaultValue,
					tabs: node.tabs.map((tab) => ({
						id: tab.id,
						value: tab.value,
						label: tab.label,
						content: <BlockChildren nodes={tab.children} />,
					})),
				})}
			</ErrorBoundary>
		</BlockEditWrapper>
	);
}

const STATEFUL = new Set(STATEFUL_COMPONENTS);

function ComponentView({ node }: { node: ComponentNode }) {
	const { components, ErrorBoundary } = useDocumentEnvironment();
	const Component: ComponentType<Record<string, unknown>> | undefined =
		node.name === "Tabs" || node.name === "Tab" ? undefined : components[node.name];
	if (!Component) {
		// `Tabs` in inline position has no tabs to show; keep what it wraps.
		if (node.name === "Tabs" || node.name === "Tab") return <NodeList nodes={node.children} />;
		return <PlaceholderView what={`component <${node.name}>`} />;
	}
	const props: Record<string, unknown> = { ...node.props };
	if (STATEFUL.has(node.name) && node.id !== null) props.id = node.id;
	// A builtin's literal `children` prop (`<Badge children="Ready" />`) stays
	// unless the element has content of its own.
	if (node.children.length > 0)
		props.children = PHRASING_BUILTINS.has(node.name) ? (
			<NodeList nodes={node.children} />
		) : (
			<BlockChildren nodes={node.children} />
		);
	return (
		<BlockEditWrapper id={node.id}>
			<ErrorBoundary resetKey={node}>
				<Component {...props} />
			</ErrorBoundary>
		</BlockEditWrapper>
	);
}

/** The lowercase elements a document may write (A3), and the table parts. */
const ELEMENT_TAGS = new Set([
	"kbd",
	"abbr",
	"sub",
	"sup",
	"mark",
	"b",
	"i",
	"u",
	"s",
	"em",
	"strong",
	"small",
	"br",
	"span",
	"details",
	"summary",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"a",
	"img",
]);
const VOID_TAGS = new Set(["br", "img"]);
const ATTRIBUTE_NAMES: Record<string, string> = { colspan: "colSpan", rowspan: "rowSpan" };

function elementProps(
	node: ElementNode,
	assetUrl: (src: string) => string,
): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(node.attrs))
		props[ATTRIBUTE_NAMES[name] ?? name] = value;
	if (node.tag === "details" && node.id !== null) props.id = node.id;
	if (node.tag === "a" && props.href === "") delete props.href;
	if (node.tag === "img" && typeof props.src === "string") props.src = assetUrl(props.src);
	return props;
}

function ElementView({ node }: { node: ElementNode }) {
	const { assetUrl } = useDocumentEnvironment();
	if (!ELEMENT_TAGS.has(node.tag)) return <PlaceholderView what={`element <${node.tag}>`} />;
	const props = elementProps(node, assetUrl);
	if (VOID_TAGS.has(node.tag)) return <RawElement tag={node.tag} props={props} />;
	if (node.tag === "details") {
		return (
			<RawElement tag={node.tag} props={props}>
				<Nested>
					<BlockChildren nodes={node.children} />
				</Nested>
			</RawElement>
		);
	}
	if (BLOCK_ELEMENTS.has(node.tag)) {
		return (
			<RawElement tag={node.tag} props={props}>
				<BlockChildren nodes={node.children} />
			</RawElement>
		);
	}
	// A phrasing element written on its own line (`<summary>Show more</summary>`)
	// holds its text bare, the way MDX renders it, not inside a paragraph.
	const [only] = node.children;
	const content =
		node.children.length === 1 && only.type === "paragraph" ? (
			<InlineList nodes={only.children} />
		) : (
			<NodeList nodes={node.children} />
		);
	return (
		<RawElement tag={node.tag} props={props}>
			{content}
		</RawElement>
	);
}

function FootnoteReference({ node }: { node: Extract<InlineNode, { type: "footnoteReference" }> }) {
	const info = useContext(FootnoteContext);
	const ids = footnoteIds(node.label, info.occurrences.get(node) ?? 1);
	return (
		<FootnoteRef
			id={ids.reference}
			target={ids.definition}
			describedBy={FOOTNOTES_ID}
			number={info.numbers.get(node.label)}
		/>
	);
}

/** Stands in for a node this client does not know, so the rest of the document still shows. */
function PlaceholderView({ what }: { what: string }) {
	return <Placeholder text={`Unsupported ${what}`} inline={useContext(InlineContext)} />;
}
