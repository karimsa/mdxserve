import type { ComponentType } from "react";
import type { z } from "zod";
import Callout, { calloutProps } from "./Callout";
import Button, { buttonProps } from "./Button";
import Tooltip, { tooltipProps } from "./Tooltip";
import Tabs, { Tab, tabsProps, tabProps } from "./Tabs";
import Badge, { badgeProps } from "./Badge";
import Diff, { diffProps } from "./Diff";
import Card, { CardGrid, cardProps, cardGridProps } from "./Card";
import Kbd, { kbdProps } from "./Kbd";
import FileTree, { fileTreeProps } from "./FileTree";
import Chart, { chartProps } from "./Chart";
import Sparkline, { sparklineProps } from "./Sparkline";
import Dropdown, { Option, dropdownProps, optionProps } from "./Dropdown";

export interface BuiltinDefinition {
	name: string;
	description: string;
	whenToUse: string;
	props: z.ZodObject<any>;
	Component: ComponentType<any>;
}

export const builtins: BuiltinDefinition[] = [
	{
		name: "Callout",
		description:
			"A boxed aside with an icon, used to draw attention to a note or warning inline with the text.",
		whenToUse:
			'Use to highlight a tip, note, or warning that should stand out from surrounding prose. Prefer `tone="warn"` for caveats or risks, `tone="danger"` for breaking changes, `tone="tip"` or `tone="ok"` for positive asides, and the default `tone="note"` for general notes; add `title` when the callout needs a short heading. (`type` is a deprecated alias for `tone`.)',
		props: calloutProps,
		Component: Callout,
	},
	{
		name: "Button",
		description:
			"A clickable button or link with primary/secondary/ghost/danger styles and a small tap animation.",
		whenToUse:
			'Use for a call to action inside MDX/JSX content — a link styled as a button (`href`) or an interactive action (`onClick`, JSX only). Prefer `variant="primary"` for the main action on a page, `secondary` or `ghost` for less prominent actions, and `danger` for destructive ones. `icon`/`iconRight` take a lucide icon name.',
		props: buttonProps,
		Component: Button,
	},
	{
		name: "Tooltip",
		description:
			"Wraps inline content in a hover/focus tooltip (via tippy.js) that shows a short bit of text.",
		whenToUse:
			"Use to add a short explanation to a word, phrase, or another inline component (e.g. a `Badge`) without cluttering the surrounding prose. Keep `content` brief — it's not meant for long-form text.",
		props: tooltipProps,
		Component: Tooltip,
	},
	{
		name: "Tabs",
		description:
			"A tabbed container that switches between panels of content, each declared with a `Tab` child.",
		whenToUse:
			"Use to present a few alternative or sequential views of content (e.g. per-language code samples, per-OS instructions) without showing them all at once. Each direct child should be a `Tab` with a `label`; the panel content cross-fades and the underline animates between tabs.",
		props: tabsProps,
		Component: Tabs,
	},
	{
		name: "Tab",
		description: "A single labeled panel within a `Tabs` container.",
		whenToUse:
			"Only as a direct child of `<Tabs>`. `label` is required; `value` defaults to a slug of `label`.",
		props: tabProps,
		Component: Tab,
	},
	{
		name: "Badge",
		description: "A small inline pill for a status, tag, or label, with tone/variant/dot options.",
		whenToUse:
			'Use inline with text (or inside a table cell) to call out a short status or category, e.g. a version, state, or tag. Prefer `variant="soft"` (the default) for most uses; `solid` for emphasis, `outline` for a quieter look; set `dot` for a status indicator. Tones: `neutral`, `teal`, `info`, `ok`, `warn`, `danger`, `note`. (`color` is a deprecated alias for `tone`.)',
		props: badgeProps,
		Component: Badge,
	},
	{
		name: "Diff",
		description:
			"Renders the difference between two code snippets with GitHub-style unified or side-by-side views.",
		whenToUse:
			"Use for before/after API changes, config migrations, or 'change this to that' instructions. Prefer a plain fence when only showing the final code.",
		props: diffProps,
		Component: Diff,
	},
	{
		name: "Card",
		description:
			"A bordered content card with an optional icon, title, description, and meta line.",
		whenToUse:
			"Use for a link or highlighted block that needs more visual weight than a plain link — a related page, an external resource, a next step. Set `href` (or `interactive`) to enable the hover lift and trailing arrow. Group several inside `CardGrid` for a responsive layout.",
		props: cardProps,
		Component: Card,
	},
	{
		name: "CardGrid",
		description: "A responsive 2- or 3-column grid for laying out `Card` elements.",
		whenToUse:
			'Wrap 2 or more `Card` elements to lay them out side by side; set `columns="3"` for a wider grid.',
		props: cardGridProps,
		Component: CardGrid,
	},
	{
		name: "Kbd",
		description: "A small styled key cap for keyboard shortcuts.",
		whenToUse:
			"Use inline for a literal keystroke, e.g. `<Kbd>⌘</Kbd><Kbd>K</Kbd>`. Not for regular inline code — use a backtick fence for that.",
		props: kbdProps,
		Component: Kbd,
	},
	{
		name: "FileTree",
		description: "A collapsible file/folder tree, for showing a project layout.",
		whenToUse:
			"Use to show the shape of a directory a reader needs to navigate, e.g. 'here's what the generated project looks like'. Pass `nodes` as a plain JSON array of `{ name, path?, children?, open? }`; set `activePath` to highlight one row.",
		props: fileTreeProps,
		Component: FileTree,
	},
	{
		name: "Chart",
		description: "A bar, line, or area chart rendered as inline SVG, framed like a code block.",
		whenToUse:
			'Use for small, self-contained datasets (four series or fewer) that are clearer as a shape than a table — trends, comparisons, distributions. `data` is `[{ label, <series>: number }, ...]`; `series` lists which keys to plot (defaults to `["value"]`). Prefer a table once there\'s more data than a chart can read at a glance.',
		props: chartProps,
		Component: Chart,
	},
	{
		name: "Sparkline",
		description: "A tiny inline trend line with no axes or labels.",
		whenToUse:
			"Use inline (e.g. in a sentence or table cell) to show the shape of a trend without a full chart — 'requests over the last hour ' next to a Sparkline. Needs at least two `values`.",
		props: sparklineProps,
		Component: Sparkline,
	},
	{
		name: "Dropdown",
		description:
			"A menu-style picker: a button that opens a popover list of options — a plain form control, or a content switcher when given `Option` children.",
		whenToUse:
			"Pass `options` (strings or `{ value, label }`) for a form-style select, e.g. a settings picker. Pass `Option` children instead — each with a `label` and its own content — to switch between longer or more numerous panels of content; prefer `Tabs` when there are only 2-4 visible alternatives, and `Dropdown` once the list gets longer than fits comfortably as tabs.",
		props: dropdownProps,
		Component: Dropdown,
	},
	{
		name: "Option",
		description: "A single labeled option within a `Dropdown` content switcher.",
		whenToUse:
			"Only as a direct child of `<Dropdown>`. `label` is required; `value` defaults to a slug of `label`.",
		props: optionProps,
		Component: Option,
	},
];

export const builtinComponents: Record<string, ComponentType<any>> = Object.fromEntries(
	builtins.map((b) => [b.name, b.Component]),
);
