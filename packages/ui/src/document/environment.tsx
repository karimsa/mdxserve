import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { BlockNode, CodeNode } from "@mdxserve/client/document/tree-types";
import type { TabsEntry } from "../builtins/Tabs";

/** A `Tabs` node, ready to draw: its id, the tab it opens on, and each tab's content. */
export interface TabsView {
	id: string;
	defaultValue: string;
	tabs: readonly TabsEntry[];
}

/** One item of a list, as the tree gives it: a task item has `checked` true or false. */
export type ListItemNode = Extract<BlockNode, { type: "list" }>["items"][number];

/** An image to draw: its URL (already through `assetUrl`), its alt text and title. */
export interface ImageView {
	src: string;
	alt: string;
	title: string | null;
}

/** What the document's editing UI wraps: a section's lines, or a block builtin. */
export interface EditableProps {
	id: string;
	kind: "section" | "block";
	children: ReactNode;
}

/**
 * What the node renderers (nodes.tsx) need from the client they run in. The web client and
 * the app each provide one, around the tree they render; nothing in the renderers knows which
 * one it is.
 */
export interface DocumentEnvironment {
	/**
	 * The builtins by name (`Tabs` and `Tab` excepted: see `renderTabs`). Each takes the props
	 * the server validated against its schema, so the map cannot type them one by one.
	 */
	components: Readonly<Record<string, ComponentType<any>>>;
	/** A `Tabs` node, with the client's own record of which tab is selected. */
	renderTabs(view: TabsView): ReactNode;
	/**
	 * A fenced code block, Mermaid diagrams included: Shiki and the Mermaid editor on the web,
	 * a plain block in the app until it highlights code (U6) and draws diagrams (phase 4).
	 */
	renderCode(node: CodeNode): ReactNode;
	/** Wraps what the reader can edit as one unit (web only: the section editor). */
	renderEditable?(props: EditableProps): ReactNode;
	/**
	 * A task list item's box. Absent, the box shows what the file says and does not toggle (the
	 * web); the app draws one the reader can tick.
	 */
	renderTaskBox?(item: ListItemNode): ReactNode;
	/** Draws an image (the app: expo-image); absent, the platform's own image element. */
	renderImage?(image: ImageView): ReactNode;
	/** The URL an image's `src` loads from (the server's `getAsset` URL in the app). */
	assetUrl(src: string): string;
	/**
	 * Handles a press on a link, or leaves it to the platform when absent: on the web an
	 * `<a href>` navigates by itself.
	 */
	openLink?(href: string): void;
	/** Catches a builtin that throws while rendering and shows the error in its place. */
	ErrorBoundary: ComponentType<{ resetKey: unknown; children: ReactNode }>;
}

const DocumentEnvironmentContext = createContext<DocumentEnvironment | null>(null);

/** Provides `value` to the node renderers below it. */
export const DocumentEnvironmentProvider = DocumentEnvironmentContext.Provider;

/** The environment the document renders in; a renderer outside one is a programming error. */
export function useDocumentEnvironment(): DocumentEnvironment {
	const environment = useContext(DocumentEnvironmentContext);
	if (!environment)
		throw new Error("Document nodes rendered outside a DocumentEnvironmentProvider");
	return environment;
}
