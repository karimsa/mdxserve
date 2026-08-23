import type { ComponentType } from "react";
import type { z } from "zod";
import Callout, { calloutProps } from "./Callout";
import Button, { buttonProps } from "./Button";
import Tooltip, { tooltipProps } from "./Tooltip";
import Tabs, { Tab, tabsProps, tabProps } from "./Tabs";
import Badge, { badgeProps } from "./Badge";
import Diff, { diffProps } from "./Diff";

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
    description: "A boxed aside with an icon, used to draw attention to a note or warning inline with the text.",
    whenToUse:
      "Use to highlight a tip, note, or warning that should stand out from surrounding prose. Prefer `type=\"warn\"` for caveats or risks and the default `type=\"info\"` for general notes; add `title` when the callout needs a short heading.",
    props: calloutProps,
    Component: Callout,
  },
  {
    name: "Button",
    description: "A clickable button or link with primary/secondary/ghost/danger styles and a small tap animation.",
    whenToUse:
      "Use for a call to action inside MDX/JSX content — a link styled as a button (`href`) or an interactive action (`onClick`, JSX only). Prefer `variant=\"primary\"` for the main action on a page, `secondary` or `ghost` for less prominent actions, and `danger` for destructive ones.",
    props: buttonProps,
    Component: Button,
  },
  {
    name: "Tooltip",
    description: "Wraps inline content in a hover/focus tooltip (via tippy.js) that shows a short bit of text.",
    whenToUse:
      "Use to add a short explanation to a word, phrase, or another inline component (e.g. a `Badge`) without cluttering the surrounding prose. Keep `content` brief — it's not meant for long-form text.",
    props: tooltipProps,
    Component: Tooltip,
  },
  {
    name: "Tabs",
    description: "A tabbed container that switches between panels of content, each declared with a `Tab` child.",
    whenToUse:
      "Use to present a few alternative or sequential views of content (e.g. per-language code samples, per-OS instructions) without showing them all at once. Each direct child should be a `Tab` with a `label`; the panel content cross-fades and the underline animates between tabs.",
    props: tabsProps,
    Component: Tabs,
  },
  {
    name: "Tab",
    description: "A single labeled panel within a `Tabs` container.",
    whenToUse: "Only as a direct child of `<Tabs>`. `label` is required; `value` defaults to a slug of `label`.",
    props: tabProps,
    Component: Tab,
  },
  {
    name: "Badge",
    description: "A small inline pill for a status, tag, or label, with color/variant/dot options.",
    whenToUse:
      "Use inline with text (or inside a table cell) to call out a short status or category, e.g. a version, state, or tag. Prefer `variant=\"soft\"` (the default) for most uses; `solid` for emphasis, `outline` for a quieter look; set `dot` for a status indicator.",
    props: badgeProps,
    Component: Badge,
  },
  {
    name: "Diff",
    description: "Renders the difference between two code snippets with GitHub-style unified or side-by-side views.",
    whenToUse:
      "Use for before/after API changes, config migrations, or 'change this to that' instructions. Prefer a plain fence when only showing the final code.",
    props: diffProps,
    Component: Diff,
  },
];

export const builtinComponents: Record<string, ComponentType<any>> = Object.fromEntries(
  builtins.map((b) => [b.name, b.Component])
);
