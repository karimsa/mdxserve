import type { Registry } from "../../src/registry.js";

/**
 * A small, hand-built registry for tests — deliberately independent of
 * dist/registry.json (which requires a build step and tracks the real
 * builtin components).
 */
export const fixtureRegistry: Registry = {
	version: 1,
	components: [
		{
			name: "Callout",
			description: "A boxed aside with an icon.",
			whenToUse: "Use to highlight a note or warning.",
			props: {
				type: "object",
				properties: {
					tone: { type: "string", enum: ["note", "tip", "warn", "danger", "ok"] },
					title: { type: "string", description: "Optional heading." },
				},
			},
		},
		{
			name: "Badge",
			description: "A small inline pill.",
			whenToUse: "Use for a short status or tag.",
			props: {
				type: "object",
				properties: {
					tone: { type: "string", enum: ["neutral", "info", "ok", "warn", "danger"] },
					dot: { type: "boolean" },
				},
			},
		},
		{
			name: "Tabs",
			description: "A tabbed container.",
			whenToUse: "Use to switch between a few panels of content.",
			props: {
				type: "object",
				properties: {},
			},
			children: "One or more `Tab` elements.",
		},
		{
			name: "Tab",
			description: "A single labeled panel within a `Tabs` container.",
			whenToUse: "Only as a direct child of `<Tabs>`.",
			props: {
				type: "object",
				properties: {
					label: { type: "string" },
					value: { type: "string" },
				},
				required: ["label"],
			},
			children: "The panel's content.",
		},
	],
};

/** Every registered component name. */
export const fixtureComponentNames = fixtureRegistry.components.map((c) => c.name);
