import { describe, expect, it } from "vitest";
import { ComponentsService } from "../../src/components/service.js";
import { fixtureRegistry as registry, fixtureComponentNames } from "../fixtures/registry.js";

const service = new ComponentsService(registry);

describe("ComponentsService.list", () => {
	it("returns every component when no query is given", () => {
		expect(service.list().map((component) => component.name)).toEqual(fixtureComponentNames);
	});

	it("matches a name case-insensitively", () => {
		expect(service.list("callout").map((component) => component.name)).toEqual(["Callout"]);
	});

	it("matches on the description", () => {
		expect(service.list("inline pill").map((component) => component.name)).toEqual(["Badge"]);
	});

	it("matches on whenToUse", () => {
		expect(service.list("switch between").map((component) => component.name)).toEqual(["Tabs"]);
	});

	it("matches on a prop name", () => {
		expect(service.list("dot").map((component) => component.name)).toEqual(["Badge"]);
	});

	it("returns nothing for a query that matches nothing", () => {
		expect(service.list("definitely-not-a-component")).toEqual([]);
	});

	it("treats a whitespace-only query as no query", () => {
		expect(service.list("   ").map((component) => component.name)).toEqual(fixtureComponentNames);
	});
});

describe("ComponentsService.listSummaries", () => {
	it("reduces props to their names, keeping the prose fields", () => {
		expect(service.listSummaries("callout")).toEqual([
			{
				name: "Callout",
				description: "A boxed aside with an icon.",
				whenToUse: "Use to highlight a note or warning.",
				props: ["tone", "title"],
			},
		]);
	});

	it("gives a component with no props an empty prop list, not undefined", () => {
		const tabs = service.listSummaries("Tabs").find((summary) => summary.name === "Tabs");
		expect(tabs?.props).toEqual([]);
	});

	it("summarizes exactly the components list() returns, in the same order", () => {
		expect(service.listSummaries().map((summary) => summary.name)).toEqual(
			service.list().map((component) => component.name),
		);
	});
});

describe("ComponentsService.find", () => {
	it("finds a component by its exact name", () => {
		expect(service.find("Badge")?.description).toBe("A small inline pill.");
	});

	it("finds a component whatever the casing", () => {
		expect(service.find("bAdGe")?.name).toBe("Badge");
	});

	it("returns undefined for an unknown name", () => {
		expect(service.find("Nope")).toBeUndefined();
	});

	it("does not match on a substring — find is exact", () => {
		expect(service.find("Bad")).toBeUndefined();
	});
});

describe("ComponentsService.suggest", () => {
	it("suggests the component a typo was aiming at", () => {
		expect(service.suggest("Calout")).toContain("Callout");
	});

	it("suggests prefix matches first", () => {
		expect(service.suggest("Ta")[0]).toBe("Tabs");
	});

	it("returns at most three suggestions", () => {
		expect(service.suggest("a").length).toBeLessThanOrEqual(3);
	});

	it("returns nothing when the name resembles no component at all", () => {
		expect(service.suggest("zzzzzzzzzzzz")).toEqual([]);
	});
});
