import type { ComponentProps } from "react";
import {
	DocumentEnvironmentProvider,
	type DocumentEnvironment,
} from "@mdxserve/ui/document/environment";
import { NodeList as SharedNodeList } from "@mdxserve/ui/document/nodes";
import { CodeBlock } from "../CodeBlock";
import { DiagramEditor, MdSection } from "../MdSection";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import Tabs from "../builtins/Tabs";
import { builtinComponents } from "../builtins/index";

export {
	FOOTNOTES_ID,
	FootnoteContext,
	footnoteIds,
	type FootnoteInfo,
} from "@mdxserve/ui/document/nodes";

/**
 * What the shared node renderers (@mdxserve/ui/document/nodes) get from the web client: its
 * builtins (with its Tabs selection and DataTable portal), Shiki code blocks and the Mermaid
 * editor, the section editor around each editable unit, and its error box. Links stay `<a href>`
 * for the browser and the router, and images load from their own `src`.
 */
const webEnvironment: DocumentEnvironment = {
	components: builtinComponents,
	renderTabs: (view) => <Tabs {...view} />,
	renderCode(node) {
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
	},
	renderEditable: ({ id, kind, children }) => (
		<MdSection id={id} kind={kind}>
			{children}
		</MdSection>
	),
	assetUrl: (src) => src,
	ErrorBoundary: RenderErrorBoundary,
};

/** The document's nodes as the web client renders them. */
export function NodeList(props: ComponentProps<typeof SharedNodeList>) {
	return (
		<DocumentEnvironmentProvider value={webEnvironment}>
			<SharedNodeList {...props} />
		</DocumentEnvironmentProvider>
	);
}
