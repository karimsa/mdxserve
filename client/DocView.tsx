import { memo, useLayoutEffect, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { DocContext } from "./DocContext";
import { ErrorBox } from "./ErrorBox";
import { useFullWidth } from "./hooks";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import type { DocModuleState } from "./doc-module-cache";
import { ResizeHandle } from "./ui/ResizeHandle";
import { DOC_MAX_WIDTH, DOC_MIN_WIDTH, docWidthAtom, openSectionAtom } from "./state";

// Each Component a re-import produces (including an HMR re-import after a
// fix) is a distinct function identity, so this assigns it a stable, unique
// number the RenderErrorBoundary below resets itself on.
const moduleKeys = new WeakMap<object, number>();
let nextModuleKey = 0;
function keyForComponent(Component: object): number {
	let key = moduleKeys.get(Component);
	if (key === undefined) {
		key = nextModuleKey++;
		moduleKeys.set(Component, key);
	}
	return key;
}

/**
 * Calls the doc's compiled content function instead of mounting it. A re-import
 * after an edit yields a new function; mounted as a component, React would see
 * a new type and rebuild the whole article. Called from this one long-lived
 * component, only the elements it returns are diffed, so unchanged blocks keep
 * their DOM and state. The content function's own hooks (`useMDXComponents`)
 * are the same on every import, so they are safe to run as this component's.
 */
function DocContent({ render }: { render: ComponentType }) {
	return (render as (props: Record<string, never>) => ReactNode)({});
}

/**
 * Memoized: the shell re-renders on every frame of a width change (the
 * comments sidebar opening, a window resize), and without this each of those
 * would re-run the whole doc's content function.
 */
export const DocView = memo(function DocView({
	path,
	module,
	onRendered,
}: {
	path: string;
	/**
	 * The cached module for `path` (client/doc-module-cache.ts), read
	 * by the caller rather than here: keeping this component's own import
	 * graph free of router.ts (and the tRPC/react-query it pulls in) is what
	 * lets client/standalone-entry.tsx reuse it without either.
	 */
	module: DocModuleState | undefined;
	/**
	 * Fired once the article for the *current* cached module is on the page —
	 * keyed on the cached entry's identity (not just route.path) so it fires
	 * exactly once per resolved module, including the async case where the
	 * initial server-rendered route's module is still importing on mount (see
	 * the bootstrap effect in client/router.ts). Lets TocRail/useToc know when
	 * it's safe to re-scan the DOM for headings.
	 */
	onRendered?: () => void;
}) {
	const cached = module;
	const fullWidth = useFullWidth();
	const setWidth = useSetAtom(docWidthAtom);
	// While a section is being edited the page width is pinned: a drag would
	// reflow the editor under the caret, and the handles' hover strips sit
	// exactly where the frame's glow and hints live.
	const editing = useAtomValue(openSectionAtom) !== null;
	const container = useRef<HTMLDivElement>(null);
	// Every `MdSection` inside `<Content/>` reads the doc's path off this
	// context (see client/DocContext.ts) instead of a prop, since MDX content
	// components render through the MDXProvider map and never see route props
	// directly. Memoized on the path so identity-sensitive children (none
	// currently, but cheap insurance) don't see a new object every render.
	const docContext = useMemo(() => ({ path }), [path]);

	useLayoutEffect(() => {
		if (cached?.status === "ok") onRendered?.();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cached, onRendered]);

	// The router always resolves the module before setting a "doc" route (see
	// client/router.ts loadRoute / the initial-route bootstrap effect), so this
	// is only ever transiently empty on the very first render after boot.
	if (!cached) return null;

	if (cached.status === "error") {
		return <ErrorBox message={cached.message} />;
	}

	const Content = cached.Component;
	return (
		<div ref={container} className="relative">
			{!editing && !fullWidth && (
				<>
					<ResizeHandle
						side="left"
						container={container}
						onResize={setWidth}
						label="Resize page"
						minWidth={DOC_MIN_WIDTH}
						maxWidth={DOC_MAX_WIDTH}
					/>
					<ResizeHandle
						side="right"
						container={container}
						onResize={setWidth}
						label="Resize page"
						minWidth={DOC_MIN_WIDTH}
						maxWidth={DOC_MAX_WIDTH}
					/>
				</>
			)}
			<article className="mdx-prose min-w-0 max-w-full">
				<DocContext value={docContext}>
					<RenderErrorBoundary resetKey={keyForComponent(Content)}>
						<DocContent render={Content} />
					</RenderErrorBoundary>
				</DocContext>
			</article>
		</div>
	);
});
