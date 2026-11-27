import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { AppErrorBoundary } from "../src/AppErrorBoundary";

describe("AppErrorBoundary", () => {
	it("switches to the error state for an error thrown below it", () => {
		const error = new TypeError("boom");
		expect(AppErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
	});

	it("shows the error's name, message and component stack, and a Reload button", () => {
		const boundary = new AppErrorBoundary({ children: createElement("p", null, "content") });
		boundary.state = { error: new TypeError("boom"), componentStack: "\n    at Editor" };
		const text = JSON.stringify(boundary.render());
		expect(text).toContain("TypeError: boom");
		expect(text).toContain("at Editor");
		expect(text).toContain("Reload");
	});

	it("renders its children when nothing threw", () => {
		const child = createElement("p", null, "content");
		expect(new AppErrorBoundary({ children: child }).render()).toBe(child);
	});
});
