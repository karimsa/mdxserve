import {
	createContext,
	createElement,
	memo,
	useContext,
	type ComponentType,
	type ReactNode,
} from "react";
import { CodeBlock } from "../CodeBlock";
import { Heading } from "../Heading";
import { DiagramEditor, MdSection } from "../MdSection";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { TaskCheckbox } from "../TaskCheckbox";
import Tabs from "../builtins/Tabs";
import { builtinComponents } from "../builtins/index";
import { STATEFUL_COMPONENTS } from "../../shared/builtins/index";
import { MarkdownTableView } from "./MarkdownTableView";
import type {
	BlockNode,
	CodeNode,
	ComponentNode,
	ElementNode,
	ErrorNode,
	InlineNode,
	SectionNode,
	TabsNode,
	TreeNode,
} from "./tree-types";

/**
 * Where a node sits for editing: at the top of the document (`root`), inside
 * an editable section (`section`), or inside a builtin, list, quote or
 * footnote (`nested`), where nothing gets an edit wrapper of its own.
 */
type EditScope = "root" | "section" | "nested";
const EditScopeContext = createContext<EditScope>("root");

/** Inside a paragraph, heading or table cell a component or element is inline. */
const InlineContext = createContext(false);

/** What a footnote reference needs: its footnote's number and its own place among that footnote's references. */
export interface FootnoteInfo {
	numbers: ReadonlyMap<string, number>;
	counts: ReadonlyMap<string, number>;
	occurrences: WeakMap<object, number>;
}
export const FootnoteContext = createContext<FootnoteInfo>({
	numbers: new Map(),
	counts: new Map(),
	occurrences: new WeakMap(),
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

/**
 * One node of the document tree. Memoized on the node object: TanStack
 * Query's structural sharing hands back the same object for a subtree that
 * did not change, so a refetch re-renders only what changed.
 */
export const NodeView = memo(function NodeView({ node }: { node: TreeNode }) {
	switch (node.type) {
		case "section":
			return <SectionView node={node} />;
		case "preamble":
			return <EditableRun id={node.id} nodes={node.children} />;
		case "paragraph":
			return (
				<p>
					<InlineList nodes={node.children} />
				</p>
			);
		case "blockquote":
			return (
				<blockquote>
					<Nested>
						<NodeList nodes={node.children} />
					</Nested>
				</blockquote>
			);
		case "list":
			return <ListView node={node} />;
		case "code":
			return <CodeView node={node} />;
		case "table":
			return <MarkdownTableView node={node} renderInline={renderInline} />;
		case "thematicBreak":
			return <hr />;
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
				<em>
					<NodeList nodes={node.children} />
				</em>
			);
		case "strong":
			return (
				<strong>
					<NodeList nodes={node.children} />
				</strong>
			);
		case "delete":
			return (
				<del>
					<NodeList nodes={node.children} />
				</del>
			);
		case "inlineCode":
			return <code>{node.value}</code>;
		case "link":
			return (
				<a href={node.href === "" ? undefined : node.href} title={node.title ?? undefined}>
					<NodeList nodes={node.children} />
				</a>
			);
		case "image":
			return <img src={node.src} alt={node.alt} title={node.title ?? undefined} />;
		case "break":
			return <br />;
		case "footnoteReference":
			return <FootnoteReference node={node} />;
		default:
			return <Placeholder what={`node type "${(node as { type?: unknown }).type}"`} />;
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
	const content = (
		<>
			{heading}
			<NodeList nodes={nodes} />
		</>
	);
	if (scope !== "root") return content;
	return (
		<EditScopeContext value="section">
			<MdSection id={id} kind="section">
				{content}
			</MdSection>
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
		<Heading level={node.level} id={node.id}>
			<InlineList nodes={node.heading} />
		</Heading>
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
	const items = node.items.map((item, index) => (
		<li key={index}>
			{item.checked === null ? null : (
				<TaskCheckbox type="checkbox" checked={item.checked} disabled />
			)}
			<Nested>
				<ListItemContent nodes={item.children} />
			</Nested>
		</li>
	));
	return node.ordered ? (
		<ol start={node.start === null || node.start === 1 ? undefined : node.start}>{items}</ol>
	) : (
		<ul>{items}</ul>
	);
}

/**
 * A list item's paragraphs show as bare text, the way a tight Markdown list
 * renders, so a task item's checkbox stays beside its text.
 */
function ListItemContent({ nodes }: { nodes: readonly BlockNode[] }) {
	return (
		<>
			{nodes.map((child, index) =>
				child.type === "paragraph" ? (
					<InlineList key={keyOf(child, index)} nodes={child.children} />
				) : (
					<NodeView key={keyOf(child, index)} node={child} />
				),
			)}
		</>
	);
}

function CodeView({ node }: { node: CodeNode }) {
	const block = (onEditDiagram?: () => void) => (
		<CodeBlock
			lang={node.lang}
			title={node.title}
			showLineNumbers={node.showLineNumbers}
			highlightLines={node.highlightLines}
			value={node.value}
			onEditDiagram={onEditDiagram}
		/>
	);
	if (node.lang !== "mermaid" || node.id === null) return block();
	return <DiagramEditor id={node.id} value={node.value} render={block} />;
}

/** A block builtin inside the document body gets an edit pencil of its own. */
function BlockEditWrapper({ id, children }: { id: string | null; children: ReactNode }) {
	const scope = useContext(EditScopeContext);
	const inline = useContext(InlineContext);
	if (id === null || inline || scope === "nested") return <Nested>{children}</Nested>;
	return (
		<MdSection id={id} kind="block">
			<Nested>{children}</Nested>
		</MdSection>
	);
}

function TabsView({ node }: { node: TabsNode }) {
	return (
		<BlockEditWrapper id={node.id}>
			<RenderErrorBoundary resetKey={node}>
				<Tabs
					id={node.id}
					defaultValue={node.defaultValue}
					tabs={node.tabs.map((tab) => ({
						id: tab.id,
						value: tab.value,
						label: tab.label,
						content: <NodeList nodes={tab.children} />,
					}))}
				/>
			</RenderErrorBoundary>
		</BlockEditWrapper>
	);
}

const STATEFUL = new Set(STATEFUL_COMPONENTS);

function ComponentView({ node }: { node: ComponentNode }) {
	const Component: ComponentType<Record<string, unknown>> | undefined =
		node.name === "Tabs" || node.name === "Tab" ? undefined : builtinComponents[node.name];
	if (!Component) {
		// `Tabs` in inline position has no tabs to show; keep what it wraps.
		if (node.name === "Tabs" || node.name === "Tab") return <NodeList nodes={node.children} />;
		return <Placeholder what={`component <${node.name}>`} />;
	}
	const props: Record<string, unknown> = { ...node.props };
	if (STATEFUL.has(node.name) && node.id !== null) props.id = node.id;
	// A builtin's literal `children` prop (`<Badge children="Ready" />`) stays
	// unless the element has content of its own.
	if (node.children.length > 0) props.children = <NodeList nodes={node.children} />;
	return (
		<BlockEditWrapper id={node.id}>
			<RenderErrorBoundary resetKey={node}>
				<Component {...props} />
			</RenderErrorBoundary>
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

function elementProps(node: ElementNode): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(node.attrs))
		props[ATTRIBUTE_NAMES[name] ?? name] = value;
	if (node.tag === "details" && node.id !== null) props.id = node.id;
	if (node.tag === "a" && props.href === "") delete props.href;
	return props;
}

function ElementView({ node }: { node: ElementNode }) {
	if (!ELEMENT_TAGS.has(node.tag)) return <Placeholder what={`element <${node.tag}>`} />;
	if (node.tag === "table") {
		return (
			<div className="data-table">
				<div className="data-table-scroll">
					<table>
						<NodeList nodes={node.children} />
					</table>
				</div>
			</div>
		);
	}
	const props = elementProps(node);
	if (VOID_TAGS.has(node.tag)) return createElement(node.tag, props);
	if (node.tag === "details") {
		return createElement(
			node.tag,
			props,
			<Nested>
				<NodeList nodes={node.children} />
			</Nested>,
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
	return createElement(node.tag, props, content);
}

function FootnoteReference({ node }: { node: Extract<InlineNode, { type: "footnoteReference" }> }) {
	const info = useContext(FootnoteContext);
	const label = node.label;
	const number = info.numbers.get(label);
	const ids = footnoteIds(label, info.occurrences.get(node) ?? 1);
	return (
		<sup>
			<a
				href={`#${ids.definition}`}
				id={ids.reference}
				data-footnote-ref=""
				aria-describedby="footnote-label"
			>
				{number ?? "?"}
			</a>
		</sup>
	);
}

/** A section that failed to parse: the parser's message and the section's source. */
function FailedSection({ node }: { node: ErrorNode }) {
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
function Placeholder({ what }: { what: string }) {
	const inline = useContext(InlineContext);
	const text = `Unsupported ${what}`;
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
