import { describe, expect, it } from "vitest";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { fixtureRegistry as registry, fixtureComponentNames } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";

const createCaller = createCallerFactory(appRouter);
const caller = createCaller(makeContext("/nonexistent-root", registry));

describe("listComponents", () => {
	it("lists every component with its prop names when no query is given", async () => {
		const { components } = await caller.listComponents({});
		expect(components.map((component) => component.name)).toEqual(fixtureComponentNames);
		expect(components.find((component) => component.name === "Badge")?.props).toEqual([
			"tone",
			"dot",
		]);
	});

	it("filters case-insensitively across name, description, whenToUse, and prop names", async () => {
		for (const query of ["callout", "boxed aside", "highlight a note", "title"]) {
			const { components } = await caller.listComponents({ query });
			expect(components.map((component) => component.name)).toContain("Callout");
		}
	});

	it("returns an empty list rather than erroring when nothing matches", async () => {
		expect(await caller.listComponents({ query: "no-such-component" })).toEqual({
			components: [],
		});
	});
});

describe("getComponent", () => {
	it("returns the full registry entry, props schema included", async () => {
		const { component } = await caller.getComponent({ name: "Callout" });
		expect(component.name).toBe("Callout");
		expect(component.props).toEqual(registry.components[0].props);
	});

	it("looks up case-insensitively", async () => {
		expect((await caller.getComponent({ name: "tAbS" })).component.name).toBe("Tabs");
	});

	it("carries `children` through for a component that takes children", async () => {
		const { component } = await caller.getComponent({ name: "Tabs" });
		expect(component.children).toBe("One or more `Tab` elements.");
	});

	it("rejects an unknown name with NOT_FOUND and a did-you-mean hint", async () => {
		await expect(caller.getComponent({ name: "Calout" })).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: 'Unknown component "Calout". Did you mean: Callout?',
		});
	});

	it("rejects an unknown name with no near miss, without an empty hint", async () => {
		await expect(caller.getComponent({ name: "zzzzzzzzzzzz" })).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: 'Unknown component "zzzzzzzzzzzz".',
		});
	});

	it("rejects an empty name at the schema, before the service is reached", async () => {
		await expect(caller.getComponent({ name: "" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});
