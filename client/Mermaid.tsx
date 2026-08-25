import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "./ui/Icon";
import { IconButton } from "./ui/IconButton";
import { ExpandModal } from "./ui/ExpandModal";
import { TRANSITIONS, VARIANTS } from "./motion";

type State = { kind: "loading" } | { kind: "ok"; svg: string } | { kind: "error"; message: string };

let mermaidPromise: Promise<(typeof import("mermaid"))["default"]> | undefined;

/** Lazy-load mermaid (it's large) only when a page actually contains a diagram. */
function loadMermaid() {
	if (!mermaidPromise) {
		mermaidPromise = import("mermaid").then((mod) => mod.default);
	}
	return mermaidPromise;
}

function cssVar(name: string, fallback: string): string {
	if (typeof window === "undefined") return fallback;
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value || fallback;
}

/** Themes mermaid from the design tokens so diagrams follow light/dark automatically. */
function themeVariables() {
	return {
		background: cssVar("--diagram-bg", "#ffffff"),
		primaryColor: cssVar("--diagram-node-bg", "#e8f6f5"),
		primaryBorderColor: cssVar("--diagram-node-border", "#2ba5a2"),
		primaryTextColor: cssVar("--diagram-node-fg", "#085b59"),
		lineColor: cssVar("--diagram-line", "#a9a8a0"),
		textColor: cssVar("--text-body", "#2b2a27"),
		fontFamily: cssVar("--font-core", "Manrope, sans-serif"),
		// Secondary / tertiary nodes (subgraphs, alt shapes) use the sunken surface
		// so nothing falls back to mermaid's own hues.
		secondaryColor: cssVar("--diagram-alt-node-bg", "#f6f6f3"),
		secondaryBorderColor: cssVar("--diagram-alt-node-border", "#cfcec7"),
		secondaryTextColor: cssVar("--text-body", "#2b2a27"),
		tertiaryColor: cssVar("--surface-sunken", "#f6f6f3"),
		tertiaryBorderColor: cssVar("--border-default", "#e3e2dd"),
		tertiaryTextColor: cssVar("--text-body", "#2b2a27"),
		// Edge labels sit on the card surface instead of mermaid's olive tint.
		edgeLabelBackground: cssVar("--diagram-label-bg", "#ffffff"),
		clusterBkg: cssVar("--surface-sunken", "#f6f6f3"),
		clusterBorder: cssVar("--border-default", "#e3e2dd"),
		// Sequence diagrams.
		actorBkg: cssVar("--diagram-node-bg", "#e8f6f5"),
		actorBorder: cssVar("--diagram-node-border", "#2ba5a2"),
		actorTextColor: cssVar("--diagram-node-fg", "#085b59"),
		actorLineColor: cssVar("--diagram-line", "#a9a8a0"),
		signalColor: cssVar("--text-body", "#2b2a27"),
		signalTextColor: cssVar("--text-body", "#2b2a27"),
		labelBoxBkgColor: cssVar("--surface-sunken", "#f6f6f3"),
		labelBoxBorderColor: cssVar("--border-default", "#e3e2dd"),
		labelTextColor: cssVar("--text-body", "#2b2a27"),
		loopTextColor: cssVar("--text-body", "#2b2a27"),
		noteBkgColor: cssVar("--status-warn-bg", "#fbeccd"),
		noteBorderColor: cssVar("--status-warn-fg", "#855603"),
		noteTextColor: cssVar("--status-warn-fg", "#855603"),
	};
}

/* Diagrams re-render whenever the reader flips light/dark: a single shared
   MutationObserver on <html data-theme> notifies every mounted MermaidDiagram
   instead of each one polling or wiring its own observer. */
const themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | undefined;

function ensureThemeObserver() {
	if (themeObserver || typeof MutationObserver === "undefined") return;
	themeObserver = new MutationObserver(() => {
		for (const listener of themeListeners) listener();
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
}

function useThemeTick(): number {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		ensureThemeObserver();
		const listener = () => setTick((current) => current + 1);
		themeListeners.add(listener);
		return () => {
			themeListeners.delete(listener);
		};
	}, []);
	return tick;
}

/** Renders mermaid `source` to inline SVG inside the code card. */
export function MermaidDiagram({ source }: { source: string }) {
	const [state, setState] = useState<State>({ kind: "loading" });
	const id = useId().replace(/[^a-zA-Z0-9]/g, "");
	const themeTick = useThemeTick();

	useEffect(() => {
		let cancelled = false;
		setState({ kind: "loading" });
		loadMermaid()
			.then((mermaid) => {
				mermaid.initialize({
					startOnLoad: false,
					theme: "base",
					themeVariables: themeVariables(),
					securityLevel: "strict",
				});
				// A fresh id per theme tick: mermaid keeps an internal render cache
				// keyed by id, so reusing one across a theme change can serve stale colours.
				return mermaid.render(`mermaid-${id}-${themeTick}`, source);
			})
			.then(({ svg }) => {
				if (!cancelled) setState({ kind: "ok", svg });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				const message = error instanceof Error ? error.message : String(error);
				setState({ kind: "error", message });
			});
		return () => {
			cancelled = true;
		};
	}, [source, id, themeTick]);

	return (
		<AnimatePresence mode="wait" initial={false}>
			{state.kind === "loading" ? (
				<motion.div
					key="loading"
					{...VARIANTS.fade}
					className="px-4 py-8 text-center text-[13px] leading-normal text-text-subtle"
				>
					Rendering diagram…
				</motion.div>
			) : state.kind === "error" ? (
				<motion.div
					key="error"
					{...VARIANTS.fade}
					className="flex items-start gap-2 px-4 py-4 text-[13px] leading-normal"
				>
					<Icon name="octagon-alert" size="sm" className="mt-0.5 shrink-0 text-status-danger-fg" />
					<div>
						<p className="mb-2 font-semibold text-status-danger-fg">
							Mermaid could not render this diagram
						</p>
						<pre className="whitespace-pre-wrap font-mono text-[length:var(--size-xs)] text-text-muted">
							{state.message}
						</pre>
					</div>
				</motion.div>
			) : (
				<motion.div key="ok" {...VARIANTS.fade}>
					<ExpandableDiagram svg={state.svg} />
				</motion.div>
			)}
		</AnimatePresence>
	);
}

/**
 * Hosts the rendered SVG in a pan/zoom viewport (drag to pan, wheel /
 * double-click to zoom, +/−/reset controls) that fills its parent. The inline
 * card gives it a fixed height; the full-screen modal gives it the whole panel.
 */
function PanZoomSvg({
	svg,
	viewportClassName,
	onExpand,
}: {
	svg: string;
	/** Sizes the viewport; the inline card uses `h-96`, the modal `h-full`. */
	viewportClassName: string;
	/** When set, an expand control opens the diagram in the full-screen modal. */
	onExpand?: () => void;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const instanceRef = useRef<SvgPanZoom.Instance | null>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		// Inject the markup imperatively (not via a React prop) so a re-render of
		// this component never resets the DOM that svg-pan-zoom mutates
		// (its viewport group + transform).
		host.innerHTML = svg;
		const el = host.querySelector("svg");
		if (!el) return;

		// svg-pan-zoom touches `window` at module load, and this file is reachable
		// from client/builtins/index.ts (via CodeBlock's CodeFrameHeader), which
		// scripts/build-registry.ts imports under plain Node — so load it lazily,
		// like mermaid itself.
		let cancelled = false;
		let instance: SvgPanZoom.Instance | null = null;
		let observer: ResizeObserver | null = null;
		import("svg-pan-zoom").then(({ default: svgPanZoom }) => {
			if (cancelled) return;

			// Mermaid sizes the SVG with a max-width + 100% width; svg-pan-zoom needs
			// it to fill the viewport so the viewBox can be fitted and panned.
			el.style.maxWidth = "none";
			el.style.width = "100%";
			el.style.height = "100%";
			el.setAttribute("width", "100%");
			el.setAttribute("height", "100%");

			instance = svgPanZoom(el, {
				zoomEnabled: true,
				panEnabled: true,
				controlIconsEnabled: false, // we render our own controls below
				mouseWheelZoomEnabled: true,
				dblClickZoomEnabled: true,
				fit: true,
				center: true,
				minZoom: 0.2,
				maxZoom: 10,
				zoomScaleSensitivity: 0.3,
			});
			instanceRef.current = instance;

			const live = instance;
			observer = new ResizeObserver(() => {
				live.resize();
				live.fit();
				live.center();
			});
			observer.observe(host);
		});

		return () => {
			cancelled = true;
			observer?.disconnect();
			try {
				// destroy() resets the zoom via the SVG's CTM, which throws an
				// InvalidStateError once the element is detached or zero-sized
				// (theme re-render, route change mid-animation). Nothing to undo then.
				instance?.destroy();
			} catch {
				// ignore
			}
			instanceRef.current = null;
			host.innerHTML = "";
		};
	}, [svg]);

	function reset() {
		const instance = instanceRef.current;
		if (!instance) return;
		instance.resize();
		instance.fit();
		instance.center();
	}

	return (
		<div className="relative h-full">
			{/* The host div is mutated imperatively (host.innerHTML = svg, above) and must
          never be re-rendered by React/motion; the fade lives on this wrapper instead. */}
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={TRANSITIONS.base}
				className="h-full"
			>
				<div
					ref={hostRef}
					className={
						"mermaid-viewport w-full cursor-grab select-none active:cursor-grabbing " +
						viewportClassName
					}
				/>
			</motion.div>
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ ...TRANSITIONS.base, delay: 0.1 }}
				className="absolute right-3 bottom-3 flex flex-col divide-y divide-border-subtle overflow-hidden rounded-md border border-border-default bg-surface-card shadow-xs"
			>
				{onExpand ? (
					<IconButton icon="expand" label="Expand diagram" size="sm" onClick={onExpand} />
				) : null}
				<IconButton
					icon="plus"
					label="Zoom in"
					size="sm"
					onClick={() => instanceRef.current?.zoomIn()}
				/>
				<IconButton icon="maximize" label="Reset view" size="sm" onClick={reset} />
				<IconButton
					icon="minus"
					label="Zoom out"
					size="sm"
					onClick={() => instanceRef.current?.zoomOut()}
				/>
			</motion.div>
		</div>
	);
}

/**
 * Inline diagram card with an expand control that opens the same SVG in a
 * near-full-screen modal, where a second pan/zoom instance gets the whole
 * viewport to explore a large diagram at scale.
 */
function ExpandableDiagram({ svg }: { svg: string }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<>
			{/* Only one copy of the markup is live at a time. Mermaid doesn't namespace
			    the ids it emits (markers, clip paths, gradients), so with both copies
			    mounted the modal's `url(#…)` references would resolve to the inline
			    SVG — the one svg-pan-zoom has already wrapped and transformed. The
			    card sits behind the scrim while expanded, so the placeholder that
			    holds its height never shows. */}
			{expanded ? (
				<div className="h-96 w-full" aria-hidden="true" />
			) : (
				<PanZoomSvg svg={svg} viewportClassName="h-96" onExpand={() => setExpanded(true)} />
			)}
			<DiagramModal open={expanded} svg={svg} onClose={() => setExpanded(false)} />
		</>
	);
}

function DiagramModal({ open, svg, onClose }: { open: boolean; svg: string; onClose: () => void }) {
	return (
		<ExpandModal
			open={open}
			onClose={onClose}
			icon="image"
			title="Diagram"
			hint="Drag to pan · scroll to zoom"
		>
			<div className="h-full bg-[var(--diagram-bg)]">
				<PanZoomSvg svg={svg} viewportClassName="h-full" />
			</div>
		</ExpandModal>
	);
}
