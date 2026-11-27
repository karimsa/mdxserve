import type { ComponentType } from "react";
import Badge from "@mdxserve/ui/builtins/Badge";
import Callout from "@mdxserve/ui/builtins/Callout";
import Tooltip from "./Tooltip";
import Tabs, { Tab } from "./Tabs";
import Diff from "./Diff";
import Card, { CardGrid } from "./Card";
import Kbd from "./Kbd";
import FileTree from "./FileTree";
import Chart from "./Chart";
import Sparkline from "./Sparkline";
import DataTable from "./DataTable";
import Screenshot from "./Screenshot";

/** Each builtin's component by name; builtinCatalog (catalog.ts) describes the same names. */
export const builtinComponents: Record<string, ComponentType<any>> = {
	DataTable,
	Callout,
	Tooltip,
	Tabs,
	Tab,
	Badge,
	Diff,
	Card,
	CardGrid,
	Kbd,
	FileTree,
	Chart,
	Sparkline,
	Screenshot,
};
