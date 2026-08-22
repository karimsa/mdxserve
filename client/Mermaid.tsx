import { useEffect, useId, useState } from "react";

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
  return (
    <div
      className="overflow-x-auto px-4 py-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // SVG produced by mermaid.render with securityLevel "strict" (sanitized).
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
