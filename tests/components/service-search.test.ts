import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ComponentsService } from "../../src/components/service.js";
import type { Registry } from "../../src/components/registry.js";

// Reused from tests/components/registry-search.test.ts (copied, not
// imported — arbitraries stay local to each test file).
const nameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,9}$/);

const registryArb: fc.Arbitrary<Registry> = fc
	.uniqueArray(nameArb, { minLength: 0, maxLength: 15 })
	.map((names) => ({
		version: 1,
		components: names.map((name) => ({ name, description: "", whenToUse: "", props: {} })),
	}));

describe("ComponentsService.list", () => {
	it("list(query) is a subset (by name) of list()", () => {
		fc.assert(
			fc.property(registryArb, fc.string({ maxLength: 10 }), (registry, query) => {
				const service = new ComponentsService(registry);
				const allNames = new Set(service.list().map((component) => component.name));
				for (const component of service.list(query)) {
					expect(allNames.has(component.name)).toBe(true);
				}
			}),
		);
	});
});

describe("ComponentsService.find", () => {
	it("is case-insensitive and its hit is present in list()", () => {
		fc.assert(
			fc.property(registryArb, nameArb, fc.boolean(), (registry, name, uppercase) => {
				const service = new ComponentsService(registry);
				const query = uppercase ? name.toUpperCase() : name.toLowerCase();
				const known = registry.components.some(
					(component) => component.name.toLowerCase() === name.toLowerCase(),
				);
				const hit = service.find(query);
				expect(hit !== undefined).toBe(known);
				if (hit) {
					expect(service.list().some((component) => component.name === hit.name)).toBe(true);
					expect(hit.name.toLowerCase()).toBe(name.toLowerCase());
				}
			}),
		);
	});

	it("returns undefined for a name that is not in the registry", () => {
		fc.assert(
			fc.property(registryArb, nameArb, (registry, name) => {
				const known = registry.components.some(
					(component) => component.name.toLowerCase() === name.toLowerCase(),
				);
				fc.pre(!known);
				const service = new ComponentsService(registry);
				expect(service.find(name)).toBeUndefined();
			}),
		);
	});
});

describe("ComponentsService.suggest", () => {
	it("returns at most 3 names, every one of which is a real registry name", () => {
		fc.assert(
			fc.property(registryArb, nameArb, (registry, query) => {
				const service = new ComponentsService(registry);
				const suggestions = service.suggest(query);
				expect(suggestions.length).toBeLessThanOrEqual(3);
				const known = new Set(registry.components.map((component) => component.name));
				for (const suggestion of suggestions) expect(known.has(suggestion)).toBe(true);
			}),
		);
	});
});
