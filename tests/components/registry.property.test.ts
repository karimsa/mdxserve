import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { suggest } from "../../src/components/registry.js";
import type { Registry } from "../../src/components/registry.js";

const nameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,9}$/);

const registryArb: fc.Arbitrary<Registry> = fc
	.uniqueArray(nameArb, { minLength: 0, maxLength: 15 })
	.map((names) => ({
		version: 1,
		components: names.map((name) => ({ name, description: "", whenToUse: "", props: {} })),
	}));

describe("suggest", () => {
	it("returns at most 3 names", () => {
		fc.assert(
			fc.property(registryArb, nameArb, (registry, query) => {
				expect(suggest(registry, query).length).toBeLessThanOrEqual(3);
			}),
		);
	});

	it("only returns names that exist in the registry", () => {
		fc.assert(
			fc.property(registryArb, nameArb, (registry, query) => {
				const known = new Set(registry.components.map((c) => c.name));
				for (const name of suggest(registry, query)) {
					expect(known.has(name)).toBe(true);
				}
			}),
		);
	});

	it("every prefix match precedes every includes-only match", () => {
		fc.assert(
			fc.property(registryArb, nameArb, (registry, query) => {
				const result = suggest(registry, query);
				const q = query.toLowerCase();
				const isPrefix = (n: string) => n.toLowerCase().startsWith(q);
				for (let i = 0; i < result.length; i++) {
					for (let j = i + 1; j < result.length; j++) {
						// No includes-only match (index i) may come before a prefix match (index j).
						expect(isPrefix(result[i]) || !isPrefix(result[j])).toBe(true);
					}
				}
			}),
		);
	});

	it("a name with one character dropped is still suggested (unless 3 better matches crowd it out)", () => {
		const longName = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{3,9}$/);
		fc.assert(
			fc.property(
				fc.uniqueArray(longName, { minLength: 1, maxLength: 15 }),
				fc.nat(),
				fc.nat(),
				(names, pick, drop) => {
					const registry: Registry = {
						version: 1,
						components: names.map((name) => ({ name, description: "", whenToUse: "", props: {} })),
					};
					const target = names[pick % names.length];
					const i = 1 + (drop % (target.length - 1));
					const typo = target.slice(0, i) + target.slice(i + 1);
					const result = suggest(registry, typo);
					expect(result.includes(target) || result.length === 3).toBe(true);
				},
			),
		);
	});
});
