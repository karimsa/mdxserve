import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentProps,
	type ReactNode,
} from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Linking,
	Pressable,
	RefreshControl,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import Animated, {
	FadeIn,
	FadeOut,
	SlideInRight,
	SlideOutRight,
	useReducedMotion,
} from "react-native-reanimated";
import {
	indexDocument,
	resolveFragment,
	type DocumentIndex,
	type TabStep,
} from "@mdxserve/client/document/document-index";
import type { DocumentTree, TreeNode } from "@mdxserve/client/document/tree-types";
import Card from "@mdxserve/ui/builtins/Card";
import Screenshot from "@mdxserve/ui/builtins/Screenshot";
import { CommentMarksContext } from "@mdxserve/ui/document/comment-marks";
import { DocContext } from "@mdxserve/ui/document/DocContext";
import { SectionHeading } from "@mdxserve/ui/document/elements";
import {
	DocumentEnvironmentProvider,
	useDocumentEnvironment,
	type DocumentEnvironment,
} from "@mdxserve/ui/document/environment";
import {
	FOOTNOTES_ID,
	FootnoteContext,
	NodeList,
	type FootnoteInfo,
} from "@mdxserve/ui/document/nodes";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { Heading, Text } from "@mdxserve/ui/primitives/Text";
import { SPRINGS } from "@mdxserve/ui/tokens/springs";
import { CommentsColumn } from "../comments/CommentsPanel";
import { commentsKey, useCommentActions, useDocThreads } from "../comments/data";
import { useCommentsModel, type CommentsStore } from "../comments/model";
import { PANEL_WIDTH, panelPlacement } from "../comments/placement";
import { RowMarker } from "../comments/RowMarker";
import { useCommentsViews, type CommentsView } from "../comments/sheet";
import { appDocumentEnvironment } from "../document-environment";
import { baseName, pathFromSegments, pathSegments } from "../library/paths";
import { realtimeFor } from "../servers/realtime";
import { ServerName } from "../servers/ServerName";
import { UnreachableServerError, useServerQueryOptions } from "../servers/server-query";
import { useServers } from "../servers/ServersProvider";
import { displayName, type KnownServer } from "../servers/store";
import { TREE_SCHEMA_VERSION } from "../servers/tree-schema";
import { useConnection } from "../servers/use-connection";
import { usePullToRefresh } from "../pull-to-refresh";
import { useSideInsets } from "../side-insets";
import { resolveLink } from "./links";
import { documentRows, rowType, type DocumentRow } from "./rows";
import { createTabSelection, TabSelectionContext } from "./tab-selection";
import { DocumentTaskBox, TaskTogglesProvider, useTaskToggles } from "./task-toggles";
import { tocLines, useContentsViews } from "./contents";

/** The Library tab's route for a document; another tab's stack passes its own. */
const LIBRARY_DOCUMENT_ROUTE = "/s/[serverId]/doc/[...path]";

/** The `getDocument` result, as the server sends it. */
interface DocumentResult {
	document: DocumentTree;
	version: string;
}

/** The URL a `getAsset` path (`/__mdxserve/getAsset?…`) or any other image `src` loads from. */
function assetUrlOn(origin: string | undefined, src: string): string {
	if (origin === undefined || !src.startsWith("/") || src.startsWith("//")) return src;
	return `${origin}${src}`;
}

/** The `getAsset` URL of a file in the server's roots. */
function fileUrl(origin: string, path: string): string {
	return `${origin}/__mdxserve/getAsset?path=${encodeURIComponent(path)}`;
}

/** The `getDocument` errors that no retry will change while the file stays as it is. */
const TERMINAL_CODES = new Set(["NOT_FOUND", "PAYLOAD_TOO_LARGE"]);

function codeOf(error: unknown): string | undefined {
	const data = (error as { data?: { code?: unknown } } | null)?.data;
	return typeof data?.code === "string" ? data.code : undefined;
}

/**
 * A document on one server (R2 to R7), for any tab's stack: its route passes `serverId`, the
 * `[...path]` segments and, optionally, `node`, a tree node id or URL fragment to reveal on
 * open (a heading link from another document, a search result). `documentRoute` is the
 * pathname links to other documents open at, so they stay in the same tab.
 */
export function DocumentScreen({
	documentRoute = LIBRARY_DOCUMENT_ROUTE,
}: {
	documentRoute?: string;
}) {
	const { serverId, path, node } = useLocalSearchParams<{
		serverId: string;
		path: string[];
		node?: string;
	}>();
	const server = useServers().servers.find((candidate) => candidate.id === serverId);
	const file = pathFromSegments(path);
	if (!server) {
		return (
			<StateView title={baseName(file)} server={undefined}>
				<Text tone="muted">This server is no longer in the list.</Text>
			</StateView>
		);
	}
	return (
		<DocumentReader
			key={`${server.id}:${file}`}
			server={server}
			path={file}
			target={typeof node === "string" && node !== "" ? node : undefined}
			documentRoute={documentRoute}
		/>
	);
}

/** The header every state of the screen shows: the server's name at the trailing edge. */
function Header({
	title,
	server,
	onContents,
	comments,
}: {
	title: string;
	server: KnownServer | undefined;
	onContents?: () => void;
	/** The Comments item: how many threads are open, and what pressing it does. */
	comments?: { open: number; onPress: () => void };
}) {
	return (
		<>
			<Stack.Screen options={{ title }} />
			<Stack.Toolbar placement="right">
				{comments ? (
					<Stack.Toolbar.Button
						icon="text.bubble"
						accessibilityLabel={`Comments, ${comments.open} open`}
						onPress={comments.onPress}
					/>
				) : null}
				{onContents ? (
					<Stack.Toolbar.Button
						icon="list.bullet"
						accessibilityLabel="Contents"
						onPress={onContents}
					/>
				) : null}
				{server ? (
					<Stack.Toolbar.View hidesSharedBackground={true}>
						<ServerName name={displayName(server)} />
					</Stack.Toolbar.View>
				) : null}
			</Stack.Toolbar>
		</>
	);
}

/** A screen that is not the document: loading, an error, or a server that cannot be read. */
function StateView({
	title,
	server,
	refreshing = false,
	onRefresh,
	children,
}: {
	title: string;
	server: KnownServer | undefined;
	refreshing?: boolean;
	onRefresh?: () => void;
	children: ReactNode;
}) {
	const sideInsets = useSideInsets();
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[sideInsets, { gap: 8, paddingVertical: 16 }]}
			refreshControl={
				onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
			}
			testID="document-state"
		>
			<Header title={title} server={server} />
			{children}
		</ScrollView>
	);
}

/** A card whose link goes where a Markdown link goes: through the screen's link handler. */
function DocumentCard({ href, ...props }: ComponentProps<typeof Card>) {
	const { openLink } = useDocumentEnvironment();
	return (
		<Card {...props} href={href} onPress={href && openLink ? () => openLink(href) : undefined} />
	);
}

/** A screenshot whose file loads from the server, as a Markdown image does. */
function DocumentScreenshot(props: ComponentProps<typeof Screenshot>) {
	const { assetUrl } = useDocumentEnvironment();
	return <Screenshot {...props} src={assetUrl(props.src)} />;
}

const SCREEN_COMPONENTS = {
	...appDocumentEnvironment.components,
	Card: DocumentCard,
	Screenshot: DocumentScreenshot,
};

/** One row of the document: its nodes, drawn by the shared renderers, and its comment marker. */
const RowView = memo(function RowView({
	nodes,
	row,
	store,
}: {
	nodes: readonly TreeNode[];
	row: number;
	store: CommentsStore;
}) {
	return (
		<View>
			<NodeList nodes={nodes} />
			<RowMarker store={store} row={row} />
		</View>
	);
});

/** The footnotes, numbered in the order their first reference appears, after the document. */
const Footnotes = memo(function Footnotes({ index }: { index: DocumentIndex }) {
	return (
		<View className="mt-6 border-t border-border-subtle pt-2">
			<SectionHeading level={2} id={FOOTNOTES_ID}>
				Footnotes
			</SectionHeading>
			{index.footnotes.map((definition) => (
				<View key={definition.label} className="flex-row gap-2">
					<Text size="sm" tone="muted" className="min-w-6 pt-2 text-right">
						{`${index.footnoteNumbers.get(definition.label) ?? ""}.`}
					</Text>
					<View className="min-w-0 flex-1">
						<NodeList nodes={definition.children} />
					</View>
				</View>
			))}
		</View>
	);
});

type ListItem = { kind: "row"; row: DocumentRow } | { kind: "footnotes" };

function DocumentReader({
	server,
	path,
	target,
	documentRoute,
}: {
	server: KnownServer;
	path: string;
	target: string | undefined;
	documentRoute: string;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const serverQuery = useServerQueryOptions();
	const sideInsets = useSideInsets();
	const connection = useConnection(server);
	const origin = connection.data?.kind === "reachable" ? connection.data.origin : undefined;
	const query = useQuery({
		...serverQuery(server, "getDocument", { path }, (client, input) =>
			client.getDocument.query(input),
		),
		// A change on disk arrives over the live update socket, which refetches it.
		staleTime: Infinity,
	});
	const data = query.data as DocumentResult | undefined;
	const tree = data?.document;
	const title = tree?.metadata.title ?? baseName(path);

	// Live updates (R4): the server's socket, joined to this document while the screen is in
	// front. A refetch keeps every unchanged subtree's object, so only what changed redraws and
	// the list keeps its place.
	const realtime = useMemo(
		() => (origin === undefined ? null : realtimeFor(server.id, origin, queryClient)),
		[origin, server.id, queryClient],
	);
	// The listener comes first: joining a document this socket joined before signals "stale" at
	// once, and that signal is what fetches the edits made while the screen was closed. The
	// document stays in its room while its Comments sheet is open, since it is still on screen
	// (and usable) behind the sheet; the sheet opens before the screen loses focus, so the room
	// is not left and joined again.
	const focused = useIsFocused();
	const [sheetKey, setSheetKey] = useState<string | null>(null);
	const live = focused || sheetKey !== null;
	useEffect(() => {
		if (!realtime || !live) return;
		const unsubscribe = realtime.onDocChanged((changed) => {
			if (changed !== path) return;
			void queryClient.invalidateQueries({ queryKey: [server.id, "getDocument", { path }] });
			// A comment written anywhere is a change to the file (KA12).
			void queryClient.invalidateQueries({ queryKey: commentsKey(server.id, path) });
		});
		realtime.joinDocument(path);
		return () => {
			realtime.leaveDocument(path);
			unsubscribe();
		};
	}, [realtime, live, path, server.id, queryClient]);

	const index = useMemo(() => (tree ? indexDocument(tree) : null), [tree]);
	const rows = useMemo(() => (tree ? documentRows(tree) : null), [tree]);
	const footnotes = useMemo<FootnoteInfo | null>(
		() =>
			index
				? {
						numbers: index.footnoteNumbers,
						counts: index.footnoteReferenceCounts,
						occurrences: index.footnoteOccurrences,
						references: index.footnoteReferences,
					}
				: null,
		[index],
	);
	const items = useMemo<ListItem[]>(() => {
		if (!rows) return [];
		const list: ListItem[] = rows.rows.map((row) => ({ kind: "row", row }));
		if (index && index.footnotes.length > 0) list.push({ kind: "footnotes" });
		return list;
	}, [rows, index]);
	const lines = useMemo(() => {
		if (!tree) return [];
		const toc = tocLines(tree.toc, index?.sectionLevels ?? new Map());
		if (index && index.footnotes.length > 0)
			toc.push({ id: FOOTNOTES_ID, label: "Footnotes", depth: 0, kind: "heading", level: 2 });
		return toc;
	}, [tree, index]);

	const [tabSelection] = useState(createTabSelection);
	const listRef = useRef<FlashListRef<ListItem>>(null);
	const toggles = useTaskToggles({ server, path, document: tree, version: data?.version });

	/** The id a link's fragment or the route's `node` names, or null when the document has none. */
	const resolve = useCallback(
		(fragment: string): string | null => {
			if (!tree || !index || !rows) return null;
			if (fragment === FOOTNOTES_ID) return fragment;
			if (rows.rowOf.has(fragment) || index.tabSteps.has(fragment)) return fragment;
			return resolveFragment(fragment, index, tree.toc);
		},
		[tree, index, rows],
	);

	/** The list item a node is drawn in; the footnotes for their heading. */
	const itemOf = useCallback(
		(id: string): number | undefined => {
			if (!rows) return undefined;
			if (id === FOOTNOTES_ID)
				return index && index.footnotes.length > 0 ? rows.rows.length : undefined;
			const row = rows.rowOf.get(id);
			return row === undefined ? undefined : Math.min(row, Math.max(rows.rows.length - 1, 0));
		},
		[rows, index],
	);

	/**
	 * Show node `id`: select every tab on the way to it, outermost first, then scroll its row to
	 * the top, as `revealNode` does on the web. A node inside a block (a heading in a tab) brings
	 * that block's top into view.
	 */
	const revealRow = useCallback(
		(item: number, tabSteps: readonly TabStep[]) => {
			for (const step of tabSteps) tabSelection.select(step.tabsId, step.value);
			// Once the selected tab has redrawn, so its row is measured with the tab it now shows.
			requestAnimationFrame(() => {
				void listRef.current?.scrollToIndex({ index: item, animated: true, viewPosition: 0 });
			});
		},
		[tabSelection],
	);
	const reveal = useCallback(
		(id: string): boolean => {
			const item = itemOf(id);
			if (item === undefined) return false;
			revealRow(item, index?.tabSteps.get(id) ?? []);
			return true;
		},
		[itemOf, index, revealRow],
	);

	const comments = useDocThreads(server, path);
	const model = useCommentsModel({
		tree,
		rows,
		threads: comments.data?.threads ?? NO_THREADS,
		revealRow,
	});
	const commentActions = useCommentActions(server, path);
	const window = useWindowDimensions();
	const placement = panelPlacement(window.width);
	const reducedMotion = useReducedMotion();

	const threads = comments.data?.threads ?? NO_THREADS;
	// A restricted server's reader sees the threads a document has and has no way to add one.
	const commentsAvailable = server.permissions !== "restricted" || threads.length > 0;
	const panelOpen = model.open && commentsAvailable;
	const commentsFailure =
		comments.isError && !comments.data
			? comments.error instanceof Error
				? comments.error.message
				: "Something went wrong."
			: null;

	// In a narrow window the comments are a sheet over the document (app/comments.tsx). It reads
	// the open view, kept current here on every render; when it goes, the panel is closed. A
	// document with no threads opens it short.
	const commentsViews = useCommentsViews();
	const { setOpen: setCommentsOpen } = model;
	const refetchThreads = comments.refetch;
	const sheetView: CommentsView = {
		model,
		actions: server.permissions === "restricted" ? null : commentActions,
		loading: comments.isPending,
		failure: commentsFailure,
		onRetry: () => void refetchThreads(),
		onClosed: () => {
			setSheetKey(null);
			setCommentsOpen(false);
		},
		empty: threads.length === 0,
	};
	const latestSheetView = useRef(sheetView);
	latestSheetView.current = sheetView;
	useEffect(() => {
		if (sheetKey !== null) commentsViews.update(sheetKey, latestSheetView.current);
	});
	useEffect(() => {
		if (placement !== "sheet" || !panelOpen || sheetKey !== null) return;
		const key = commentsViews.open(latestSheetView.current);
		setSheetKey(key);
		router.push({ pathname: "/comments", params: { view: key } });
	}, [placement, panelOpen, sheetKey, commentsViews, router]);
	useEffect(
		() => () => {
			if (sheetKey !== null) commentsViews.close(sheetKey);
		},
		[commentsViews, sheetKey],
	);

	// The route's `node`, revealed once the document is first on screen.
	const revealedTarget = useRef(false);
	useEffect(() => {
		if (target === undefined || revealedTarget.current || !rows) return;
		revealedTarget.current = true;
		const id = resolve(target);
		if (id !== null) reveal(id);
	}, [target, rows, resolve, reveal]);

	// The latest of each, for the environment, which stays one object while the server's address
	// stays the same, so a refetch does not redraw every node.
	const latest = useRef({ reveal, resolve });
	latest.current = { reveal, resolve };

	// The Contents sheet (app/contents.tsx) reads the lines from the open view, kept current when
	// the document's data changes under it (a refetch landing). The screen leaves the live update
	// room while the sheet covers it and catches up when it is back in front. A line goes through
	// the latest index, so an id the document no longer has reveals nothing.
	const contentsViews = useContentsViews();
	const [contentsKey, setContentsKey] = useState<string | null>(null);
	const choose = useCallback((id: string) => void latest.current.reveal(id), []);
	useEffect(() => {
		if (contentsKey !== null) contentsViews.update(contentsKey, { lines, choose });
	}, [contentsViews, contentsKey, lines, choose]);
	useEffect(
		() => () => {
			if (contentsKey !== null) contentsViews.close(contentsKey);
		},
		[contentsViews, contentsKey],
	);
	const openContents = () => {
		const key = contentsViews.open({ lines, choose });
		setContentsKey(key);
		router.push({ pathname: "/contents", params: { view: key } });
	};

	const environment = useMemo<DocumentEnvironment>(() => {
		function openLink(href: string) {
			const link = resolveLink(href, path);
			const current = latest.current;
			switch (link.kind) {
				case "here": {
					const id = current.resolve(link.fragment);
					if (id !== null) current.reveal(id);
					return;
				}
				case "document":
					router.push({
						pathname: documentRoute as never,
						params: {
							serverId: server.id,
							path: pathSegments(link.path),
							...(link.fragment === "" ? {} : { node: link.fragment }),
						},
					});
					return;
				case "folder":
					router.push({
						pathname: "/s/[serverId]/browse/[...path]",
						params: { serverId: server.id, path: pathSegments(link.path) },
					});
					return;
				case "file":
					if (origin !== undefined) void Linking.openURL(fileUrl(origin, link.path));
					return;
				case "web":
					void Linking.openURL(link.url);
					return;
				case "none":
					return;
			}
		}
		const assetUrl = (src: string) => assetUrlOn(origin, src);
		return {
			...appDocumentEnvironment,
			components: SCREEN_COMPONENTS,
			// A new address makes a new environment, so every image reloads from it.
			assetUrl,
			renderTaskBox: (item) => <DocumentTaskBox item={item} />,
			openLink,
		};
	}, [origin, path, router, documentRoute, server.id]);
	const docContext = useMemo(() => ({ path }), [path]);

	const { refetch } = query;
	const refetchComments = comments.refetch;
	const pull = usePullToRefresh(
		useCallback(async () => {
			const [result] = await Promise.all([refetch(), refetchComments()]);
			return result;
		}, [refetch, refetchComments]),
	);

	if (
		server.treeSchemaVersion > TREE_SCHEMA_VERSION ||
		(tree && tree.schemaVersion > TREE_SCHEMA_VERSION)
	) {
		return (
			<StateView title={title} server={server}>
				<Heading level={2}>{title}</Heading>
				<Text paragraph={true}>Update the app to read this server.</Text>
				<Text tone="muted" size="sm" paragraph={true}>
					This server sends documents in a newer form than this version of the app can show.
				</Text>
			</StateView>
		);
	}

	// A document the server will not give any more (deleted, renamed, grown too large) says so,
	// even when an earlier read of it is still in the cache; any other failure keeps that read.
	const terminal = TERMINAL_CODES.has(codeOf(query.error) ?? "");
	if (!data || terminal) {
		if (!data && query.isPending) {
			return (
				<StateView title={title} server={server}>
					<View className="py-6" accessibilityLabel="Loading the document">
						<ActivityIndicator size="small" />
					</View>
				</StateView>
			);
		}
		const error = query.error;
		const code = codeOf(error);
		return (
			<StateView
				title={title}
				server={server}
				refreshing={pull.refreshing}
				onRefresh={pull.onRefresh}
			>
				<Heading level={2}>{baseName(path)}</Heading>
				{error instanceof UnreachableServerError ? (
					<View className="flex-row items-center gap-3 py-3">
						<Icon name="cloud-off" size="md" className="text-text-subtle" />
						<View className="flex-1">
							<Text weight="semibold">{displayName(server)}</Text>
							<Text size="sm" tone="muted">
								{error.message}
							</Text>
						</View>
					</View>
				) : code === "NOT_FOUND" ? (
					<Text paragraph={true}>
						This document is not on the server, or the server will not show it.
					</Text>
				) : code === "PAYLOAD_TOO_LARGE" ? (
					<Text paragraph={true}>This document is too large to show.</Text>
				) : (
					<Text paragraph={true}>{error?.message ?? "The document could not be read."}</Text>
				)}
				<Text size="sm" tone="muted" paragraph={true}>
					Pull down to try again.
				</Text>
			</StateView>
		);
	}

	const failed = rows
		? rows.rows.flatMap((row) => row.nodes.filter((node) => node.type === "error"))
		: [];
	const hasTitle = data.document.children.some(
		(node) => node.type === "section" && node.level === 1,
	);
	const header = (
		<View>
			{hasTitle ? null : <Heading level={1}>{title}</Heading>}
			{failed.length > 0 ? (
				<Pressable
					role="button"
					onPress={() => {
						const first = failed[0];
						if (first?.type === "error") reveal(first.id);
					}}
					className="my-2 flex-row items-center gap-2 rounded border border-status-danger-fg/30 bg-status-danger-bg p-3"
				>
					<Icon name="triangle-alert" size="sm" className="text-status-danger-fg" />
					<Text size="sm" className="flex-1 text-status-danger-fg">
						{failed.length === 1
							? "One part of this document could not be read. It is shown as its source."
							: `${failed.length} parts of this document could not be read. They are shown as their source.`}
					</Text>
				</Pressable>
			) : null}
		</View>
	);

	// In a wide window the comments are a column beside the document, unless a sheet opened in
	// a narrow one is still up.
	const column = panelOpen && placement === "beside" && sheetKey === null;
	const glide = SPRINGS.glide;
	const entering = reducedMotion
		? FadeIn
		: SlideInRight.springify().stiffness(glide.stiffness).damping(glide.damping).mass(glide.mass);
	const exiting = reducedMotion ? FadeOut : SlideOutRight;

	return (
		<DocumentEnvironmentProvider value={environment}>
			<DocContext value={docContext}>
				<FootnoteContext value={footnotes ?? EMPTY_FOOTNOTES}>
					<TabSelectionContext value={tabSelection}>
						<TaskTogglesProvider value={toggles}>
							<CommentMarksContext value={model.store}>
								<Header
									title={title}
									server={server}
									onContents={lines.length > 0 ? openContents : undefined}
									comments={
										commentsAvailable
											? {
													open: model.grouped.open.length + model.grouped.detached.length,
													// Opens the comments, or closes them: the column from here, and the
													// sheet (the top route while it is up) by going back from it.
													onPress: () => {
														if (sheetKey !== null) router.back();
														else model.setOpen(!model.open);
													},
												}
											: undefined
									}
								/>
								<KeyboardAvoidingView behavior="padding" style={{ flex: 1, flexDirection: "row" }}>
									<View style={{ flex: 1 }} testID="document-pane">
										<FlashList
											ref={listRef}
											data={items}
											keyExtractor={(item) => (item.kind === "row" ? item.row.key : "~footnotes")}
											getItemType={(item) =>
												item.kind === "row" ? rowType(item.row) : "footnotes"
											}
											renderItem={({ item, index: position }) =>
												item.kind === "row" ? (
													<RowView nodes={item.row.nodes} row={position} store={model.store} />
												) : index ? (
													<Footnotes index={index} />
												) : null
											}
											ListHeaderComponent={header}
											contentInsetAdjustmentBehavior="automatic"
											contentContainerStyle={{
												...sideInsets,
												// Beside the panel the document keeps a gutter from it, not from the window.
												...(column ? { paddingRight: 16 } : {}),
												paddingTop: 8,
												paddingBottom: 32,
											}}
											refreshControl={
												<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />
											}
											testID="document-content"
										/>
									</View>
									{column ? (
										<Animated.View
											entering={entering}
											exiting={exiting}
											style={{ width: PANEL_WIDTH }}
											testID="comments-dock"
										>
											<CommentsColumn
												model={model}
												loading={sheetView.loading}
												failure={sheetView.failure}
												onRetry={sheetView.onRetry}
												actions={sheetView.actions}
											/>
										</Animated.View>
									) : null}
								</KeyboardAvoidingView>
							</CommentMarksContext>
						</TaskTogglesProvider>
					</TabSelectionContext>
				</FootnoteContext>
			</DocContext>
		</DocumentEnvironmentProvider>
	);
}

const NO_THREADS: readonly never[] = [];

const EMPTY_FOOTNOTES: FootnoteInfo = {
	numbers: new Map(),
	counts: new Map(),
	occurrences: new WeakMap(),
	references: [],
};
