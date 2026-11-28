/**
 * Mermaid's theme from the design tokens, for both clients: the web client reads each token
 * with `getComputedStyle`, the app through Uniwind's compiled classes. One table, so a diagram
 * gets the same colours in either. Import-free and browser-safe, like `mermaid-chart.ts`.
 */

/** The design tokens Mermaid's theme reads, with the value used where none can be read. */
export const MERMAID_TOKEN_FALLBACKS = {
	"--diagram-bg": "#ffffff",
	"--diagram-node-bg": "#e8f6f5",
	"--diagram-node-border": "#2ba5a2",
	"--diagram-node-fg": "#085b59",
	"--diagram-line": "#a9a8a0",
	"--text-body": "#2b2a27",
	"--font-core": "Manrope, sans-serif",
	"--diagram-alt-node-bg": "#f6f6f3",
	"--diagram-alt-node-border": "#cfcec7",
	"--surface-sunken": "#f6f6f3",
	"--border-default": "#e3e2dd",
	"--diagram-label-bg": "#ffffff",
	"--status-warn-bg": "#fbeccd",
	"--status-warn-fg": "#855603",
} as const;

export type MermaidToken = keyof typeof MERMAID_TOKEN_FALLBACKS;

/** Mermaid's `themeVariables` for its "base" theme, each from the token `resolve` reads. */
export function mermaidThemeVariables(
	resolve: (token: MermaidToken) => string,
): Record<string, string> {
	return {
		background: resolve("--diagram-bg"),
		primaryColor: resolve("--diagram-node-bg"),
		primaryBorderColor: resolve("--diagram-node-border"),
		primaryTextColor: resolve("--diagram-node-fg"),
		lineColor: resolve("--diagram-line"),
		textColor: resolve("--text-body"),
		fontFamily: resolve("--font-core"),
		// Secondary / tertiary nodes (subgraphs, alt shapes) use the sunken surface
		// so nothing falls back to mermaid's own hues.
		secondaryColor: resolve("--diagram-alt-node-bg"),
		secondaryBorderColor: resolve("--diagram-alt-node-border"),
		secondaryTextColor: resolve("--text-body"),
		tertiaryColor: resolve("--surface-sunken"),
		tertiaryBorderColor: resolve("--border-default"),
		tertiaryTextColor: resolve("--text-body"),
		// Edge labels sit on the card surface instead of mermaid's olive tint.
		edgeLabelBackground: resolve("--diagram-label-bg"),
		clusterBkg: resolve("--surface-sunken"),
		clusterBorder: resolve("--border-default"),
		// ER diagrams: attribute rows default to mermaid's hard-coded white / #f2f2f2,
		// unreadable under the light `textColor` in dark mode. Alternate the card and
		// sunken surfaces instead so rows follow the theme like every other node.
		attributeBackgroundColorOdd: resolve("--diagram-bg"),
		attributeBackgroundColorEven: resolve("--diagram-alt-node-bg"),
		// Sequence diagrams.
		actorBkg: resolve("--diagram-node-bg"),
		actorBorder: resolve("--diagram-node-border"),
		actorTextColor: resolve("--diagram-node-fg"),
		actorLineColor: resolve("--diagram-line"),
		signalColor: resolve("--text-body"),
		signalTextColor: resolve("--text-body"),
		labelBoxBkgColor: resolve("--surface-sunken"),
		labelBoxBorderColor: resolve("--border-default"),
		labelTextColor: resolve("--text-body"),
		loopTextColor: resolve("--text-body"),
		noteBkgColor: resolve("--status-warn-bg"),
		noteBorderColor: resolve("--status-warn-fg"),
		noteTextColor: resolve("--status-warn-fg"),
	};
}
