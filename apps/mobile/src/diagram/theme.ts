import { useMemo } from "react";
import { useResolveClassNames } from "uniwind";
import { mermaidThemeVariables, type MermaidToken } from "@mdxserve/shared/mermaid-theme";

/** The family the diagram page embeds (scripts/diagram-page/build.js). */
const DIAGRAM_FONT = "Manrope, -apple-system, sans-serif";

/** The colour a `text-*` class resolves to in the current theme. */
function useTextColor(className: string): string {
	const style = useResolveClassNames(className);
	return typeof style.color === "string" ? style.color : "transparent";
}

/**
 * Mermaid's `themeVariables` for the app's current theme, from the same table the web client
 * uses. Each token is read through a class the stylesheet compiles, written out one per token
 * so Tailwind sees every class. The object changes only when a colour does.
 */
export function useDiagramTheme(): Record<string, string> {
	const resolved: Record<MermaidToken, string> = {
		"--diagram-bg": useTextColor("text-diagram-bg"),
		"--diagram-node-bg": useTextColor("text-diagram-node-bg"),
		"--diagram-node-border": useTextColor("text-diagram-node-border"),
		"--diagram-node-fg": useTextColor("text-diagram-node-fg"),
		"--diagram-line": useTextColor("text-diagram-line"),
		"--diagram-alt-node-bg": useTextColor("text-diagram-alt-node-bg"),
		"--diagram-alt-node-border": useTextColor("text-diagram-alt-node-border"),
		"--diagram-label-bg": useTextColor("text-diagram-label-bg"),
		"--text-body": useTextColor("text-text-body"),
		"--surface-sunken": useTextColor("text-surface-sunken"),
		"--border-default": useTextColor("text-border-default"),
		"--status-warn-bg": useTextColor("text-status-warn-bg"),
		"--status-warn-fg": useTextColor("text-status-warn-fg"),
		"--font-core": DIAGRAM_FONT,
	};
	const key = JSON.stringify(resolved);
	return useMemo(() => {
		const values = JSON.parse(key) as Record<MermaidToken, string>;
		return mermaidThemeVariables((token) => values[token]);
	}, [key]);
}
