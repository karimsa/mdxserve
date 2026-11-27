/** What `mdxserve components` and the registry say about a builtin. */
export interface BuiltinDescription {
	name: string;
	description: string;
	whenToUse: string;
}

/**
 * Every builtin's description, kept apart from the components so the registry build
 * (scripts/build-registry.ts) reads it under plain Node, which cannot load React Native
 * components. Its prop schema comes from @mdxserve/shared/builtins.
 */
export const builtinCatalog: readonly BuiltinDescription[] = [
	{
		name: "DataTable",
		description:
			"A bordered, sortable, filterable data table with typed columns, unit selection, grouped headers and optional bars.",
		whenToUse:
			"Use for datasets and quantitative comparisons; use native Markdown tables for facts and prose. Required stable document-unique id. Columns have key, label, type (text/number/percent/time/bytes/currency), optional group and bars. Percent values are fractions (0.15 means 15%). Time and bytes require unit; currency requires numeric data and an ISO 4217 currency code, e.g. currency: USD. Bars are opt-in and independently scaled by column. Reader state is local to the document and ID.",
	},
	{
		name: "Callout",
		description:
			"A boxed aside with an icon, used to draw attention to a note or warning inline with the text.",
		whenToUse:
			'Use to highlight a tip, note, or warning that should stand out from surrounding prose. Prefer `tone="warn"` for caveats or risks, `tone="danger"` for breaking changes, `tone="tip"` or `tone="ok"` for positive asides, and the default `tone="note"` for general notes; add `title` when the callout needs a short heading. (`type` is a deprecated alias for `tone`.)',
	},
	{
		name: "Tooltip",
		description:
			"Wraps inline content in a hover/focus tooltip (via tippy.js) that shows a short bit of text.",
		whenToUse:
			"Use to add a short explanation to a word, phrase, or another inline component (e.g. a `Badge`) without cluttering the surrounding prose. Keep `content` brief — it's not meant for long-form text.",
	},
	{
		name: "Tabs",
		description:
			"A tabbed container that switches between panels of content, each declared with a `Tab` child.",
		whenToUse:
			"Use to present a few alternative or sequential views of content (e.g. per-language code samples, per-OS instructions) without showing them all at once. Each direct child should be a `Tab` with a `label`; the panel content cross-fades and the underline animates between tabs. Requires an `id` that is unique in the document; reader state for the block is kept under it.",
	},
	{
		name: "Tab",
		description: "A single labeled panel within a `Tabs` container.",
		whenToUse:
			"Only as a direct child of `<Tabs>`. `label` is required; `value` defaults to a slug of `label`.",
	},
	{
		name: "Badge",
		description: "A small inline pill for a status, tag, or label, with tone/variant/dot options.",
		whenToUse:
			'Use inline with text (or inside a table cell) to call out a short status or category, e.g. a version, state, or tag. Prefer `variant="soft"` (the default) for most uses; `solid` for emphasis, `outline` for a quieter look; set `dot` for a status indicator. Tones: `neutral`, `teal`, `info`, `ok`, `warn`, `danger`, `note`. (`color` is a deprecated alias for `tone`.)',
	},
	{
		name: "Diff",
		description:
			"Renders the difference between two code snippets with GitHub-style unified or side-by-side views.",
		whenToUse:
			"Use for before/after API changes, config migrations, or 'change this to that' instructions. Prefer a plain fence when only showing the final code. Requires an `id` that is unique in the document; reader state for the block is kept under it.",
	},
	{
		name: "Card",
		description:
			"A bordered content card with an optional icon, title, description, and meta line.",
		whenToUse:
			"Use for a link or highlighted block that needs more visual weight than a plain link — a related page, an external resource, a next step. Set `href` (or `interactive`) to enable the hover lift and trailing arrow. Group several inside `CardGrid` for a responsive layout.",
	},
	{
		name: "CardGrid",
		description: "A responsive 2- or 3-column grid for laying out `Card` elements.",
		whenToUse:
			'Wrap 2 or more `Card` elements to lay them out side by side; set `columns="3"` for a wider grid.',
	},
	{
		name: "Kbd",
		description: "A small styled key cap for keyboard shortcuts.",
		whenToUse:
			"Use inline for a literal keystroke, e.g. `<Kbd>⌘</Kbd><Kbd>K</Kbd>`. Not for regular inline code — use a backtick fence for that.",
	},
	{
		name: "FileTree",
		description: "A collapsible file/folder tree, for showing a project layout.",
		whenToUse:
			"Use to show the shape of a directory a reader needs to navigate, e.g. 'here's what the generated project looks like'. Pass `nodes` as a plain JSON array of `{ name, path?, children?, open? }`; set `activePath` to highlight one row. Requires an `id` that is unique in the document; reader state for the block is kept under it.",
	},
	{
		name: "Chart",
		description:
			"A bar, line, area or histogram chart rendered as inline SVG, framed like a code block.",
		whenToUse:
			'For bar, line and area: `data` is `[{ label, <series>: number }, ...]`; `series` lists which keys to plot (defaults to `["value"]`), for small, self-contained datasets (four series or fewer) that are clearer as a shape than a table. Set `orientation="horizontal"` on a bar chart when labels are long or there are more than ~6 categories. For a histogram, set `type="histogram"` and pass raw numbers as `values`; leave `data`/`series` off and optionally cap the bin count with `bins`. Prefer a table once there\'s more data than a chart can read at a glance. Requires an `id` that is unique in the document; reader state for the block is kept under it.',
	},
	{
		name: "Sparkline",
		description: "A tiny inline trend line with no axes or labels.",
		whenToUse:
			"Use inline (e.g. in a sentence or table cell) to show the shape of a trend without a full chart — 'requests over the last hour ' next to a Sparkline. Needs at least two `values`.",
	},
	{
		name: "Screenshot",
		description:
			"An image framed as a macOS window — traffic-light buttons, an optional title, a raised border — for app and UI screenshots.",
		whenToUse:
			"Use instead of a plain Markdown image when the picture is a screenshot of an app, web page, or terminal, so it reads as a window rather than a bare bitmap. `src` resolves like a Markdown image; add `title` for the window name and `caption` for a note below. The title bar's expand control opens the image full-screen with pan and zoom, so a dense screenshot can stay small inline. Keep plain `![alt](src)` for diagrams, logos, and photos. Requires an `id` that is unique in the document; reader state for the block is kept under it.",
	},
];
