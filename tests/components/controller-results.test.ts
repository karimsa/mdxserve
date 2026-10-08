import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import {
	listComponentsResultSchema,
	getComponentResultSchema,
} from "../../src/components/controller.js";
import type { Registry } from "../../src/components/registry.js";
import { makeContext } from "../helpers/context.js";

const createCaller = createCallerFactory(appRouter);

const nameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,9}$/);
const wordArb = fc.constantFrom("boxed", "inline", "panel", "status", "aside", "tabbed");
const proseArb = fc.array(wordArb, { minLength: 0, maxLength: 4 }).map((words) => words.join(" "));

const registryArb: fc.Arbitrary<Registry> = fc
	.uniqueArray(fc.tuple(nameArb, proseArb, proseArb, fc.uniqueArray(nameArb, { maxLength: 4 })), {
		minLength: 0,
		maxLength: 10,
		// Names resolve case-insensitively (getComponent "tAbS" → Tabs), so two
		// entries that differ only by case would shadow each other.
		selector: ([name]) => name.toLowerCase(),
	})
	.map((entries) => ({
		version: 1,
		components: entries.map(([name, description, whenToUse, propNames]) => ({
			name,
			description,
			whenToUse,
			props: {
				type: "object",
				properties: Object.fromEntries(propNames.map((prop) => [prop, { type: "string" }])),
			},
		})),
	}));

function callerFor(registry: Registry) {
	return createCaller(makeContext("/nonexistent-root", registry));
}

describe("listComponents properties", () => {
	it("output always parses under its schema, and every filtered result is in the unfiltered one", async () => {
		await fc.assert(
			fc.asyncProperty(registryArb, fc.string({ maxLength: 8 }), async (registry, query) => {
				const caller = callerFor(registry);
				const all = await caller.listComponents({});
				const filtered = await caller.listComponents({ query });

				expect(listComponentsResultSchema.parse(all)).toEqual(all);
				expect(listComponentsResultSchema.parse(filtered)).toEqual(filtered);

				const allNames = new Set(all.components.map((component) => component.name));
				for (const component of filtered.components) {
					expect(allNames.has(component.name)).toBe(true);
				}
			}),
			{ numRuns: 30 },
		);
	});

	it("lists exactly the registry's components, in registry order, when unfiltered", async () => {
		await fc.assert(
			fc.asyncProperty(registryArb, async (registry) => {
				const { components } = await callerFor(registry).listComponents({});
				expect(components.map((component) => component.name)).toEqual(
					registry.components.map((component) => component.name),
				);
			}),
			{ numRuns: 30 },
		);
	});

	it("a component's own name always finds it", async () => {
		await fc.assert(
			fc.asyncProperty(registryArb, async (registry) => {
				const caller = callerFor(registry);
				for (const component of registry.components) {
					const { components } = await caller.listComponents({ query: component.name });
					expect(components.map((entry) => entry.name)).toContain(component.name);
				}
			}),
			{ numRuns: 20 },
		);
	});
});

describe("getComponent properties", () => {
	it("every listed component resolves, parses under its schema, and round-trips its name", async () => {
		await fc.assert(
			fc.asyncProperty(registryArb, async (registry) => {
				const caller = callerFor(registry);
				const { components } = await caller.listComponents({});
				for (const summary of components) {
					const result = await caller.getComponent({ name: summary.name });
					expect(getComponentResultSchema.parse(result)).toEqual(result);
					expect(result.component.name).toBe(summary.name);
					expect(Object.keys((result.component.props.properties ?? {}) as object)).toEqual(
						summary.props,
					);
				}
			}),
			{ numRuns: 20 },
		);
	});

	it("a name no component has is always NOT_FOUND", async () => {
		await fc.assert(
			fc.asyncProperty(registryArb, nameArb, async (registry, name) => {
				const known = new Set(registry.components.map((component) => component.name.toLowerCase()));
				fc.pre(!known.has(name.toLowerCase()));
				await expect(callerFor(registry).getComponent({ name })).rejects.toMatchObject({
					code: "NOT_FOUND",
				});
			}),
			{ numRuns: 30 },
		);
	});

	it("lookup is case-insensitive: any casing of a known name resolves to the same entry", async () => {
		await fc.assert(
			fc.asyncProperty(registryArb, async (registry) => {
				const caller = callerFor(registry);
				for (const component of registry.components) {
					const upper = await caller.getComponent({ name: component.name.toUpperCase() });
					const lower = await caller.getComponent({ name: component.name.toLowerCase() });
					expect(upper).toEqual(lower);
				}
			}),
			{ numRuns: 20 },
		);
	});
});
