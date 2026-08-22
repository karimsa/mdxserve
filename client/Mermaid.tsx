import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import svgPanZoom from "svg-pan-zoom";

type State = { kind: "loading" } | { kind: "ok"; svg: string } | { kind: "error"; message: string };

let mermaidPromise: Promise<typeof import("mermaid")["default"]> | undefined;

/** Lazy-load mermaid (it's large) only when a page actually contains a diagram. */
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        // The code card is always dark, so the diagram always uses the dark theme.
        theme: "dark",
        securityLevel: "strict",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/** Renders mermaid `source` to inline SVG inside the code card. */
export function MermaidDiagram({ source }: { source: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    loadMermaid()
      .then((mermaid) => mermaid.render(`mermaid-${id}`, source))
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
  }, [source, id]);

  if (state.kind === "loading") {
    return <div className="px-4 py-8 text-center text-xs text-gray-500">Rendering diagram…</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="px-4 py-4 text-sm text-red-300">
        <p className="mb-2 font-medium">Mermaid could not render this diagram</p>
        <pre className="whitespace-pre-wrap font-mono text-xs text-red-200/80">{state.message}</pre>
      </div>
    );
  }
  return <PanZoomSvg svg={state.svg} />;
}

/**
 * Hosts the rendered SVG in a fixed-height viewport with svg-pan-zoom
 * (drag to pan, wheel / double-click to zoom, +/−/reset controls).
 */
function PanZoomSvg({ svg }: { svg: string }) {
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

    // Mermaid sizes the SVG with a max-width + 100% width; svg-pan-zoom needs
    // it to fill the viewport so the viewBox can be fitted and panned.
    el.style.maxWidth = "none";
    el.style.width = "100%";
    el.style.height = "100%";
    el.setAttribute("width", "100%");
    el.setAttribute("height", "100%");

    const instance = svgPanZoom(el, {
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

    const observer = new ResizeObserver(() => {
      instance.resize();
      instance.fit();
      instance.center();
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      instance.destroy();
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
    <div className="relative">
      <div
        ref={hostRef}
        className="mermaid-viewport h-96 w-full cursor-grab select-none active:cursor-grabbing"
      />
      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-md bg-gray-900/90 shadow-sm ring-1 ring-white/10 backdrop-blur">
        <ControlButton label="Zoom in" onClick={() => instanceRef.current?.zoomIn()}>
          <path d="M8 3.5v9M3.5 8h9" />
        </ControlButton>
        <ControlButton label="Reset view" onClick={reset}>
          <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2M3.5 3v2.5H6" />
        </ControlButton>
        <ControlButton label="Zoom out" onClick={() => instanceRef.current?.zoomOut()}>
          <path d="M3.5 8h9" />
        </ControlButton>
      </div>
    </div>
  );
}

function ControlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-7 w-7 cursor-pointer items-center justify-center text-gray-400 transition-colors hover:bg-white/10 hover:text-white [&+&]:border-t [&+&]:border-white/10"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
