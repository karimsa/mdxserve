import type { z } from "zod";
import { badgeProps } from "./badge";
import { calloutProps } from "./callout";
import { cardGridProps, cardProps } from "./card";
import { chartProps } from "./chart";
import { dataTableProps } from "./data-table";
import { diffProps } from "./diff";
import { fileTreeProps } from "./file-tree";
import { kbdProps } from "./kbd";
import { screenshotProps } from "./screenshot";
import { sparklineProps } from "./sparkline";
import { tabProps, tabsProps } from "./tabs";
import { tooltipProps } from "./tooltip";

/**
 * Each builtin's prop schema by component name. The client's components and
 * the server's document parser read the same objects, so a prop the parser
 * accepts is a prop the component understands.
 */
export const builtinPropSchemas: Readonly<Record<string, z.ZodObject>> = {
	DataTable: dataTableProps,
	Callout: calloutProps,
	Tooltip: tooltipProps,
	Tabs: tabsProps,
	Tab: tabProps,
	Badge: badgeProps,
	Diff: diffProps,
	Card: cardProps,
	CardGrid: cardGridProps,
	Kbd: kbdProps,
	FileTree: fileTreeProps,
	Chart: chartProps,
	Sparkline: sparklineProps,
	Screenshot: screenshotProps,
};

/** Builtins whose reader state is kept under their `id`, so a document must give them one. */
export const STATEFUL_COMPONENTS: readonly string[] = [
	"DataTable",
	"Tabs",
	"Diff",
	"FileTree",
	"Chart",
	"Screenshot",
];
