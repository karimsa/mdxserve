import { describe, expect, it, jest } from "@jest/globals";
import * as fc from "fast-check";
import { renderCall, zoomCall, type RenderRequest } from "../src/diagram/render-call";

/** Runs the injected call against a fake page, as WebKit would, and gives what it was called with. */
function run(code: string, method: "render" | "zoom" = "render"): unknown[] {
	const called = jest.fn();
	// eslint-disable-next-line no-new-func -- running the generated call is the point of the test
	new Function("window", code)({ mdxserveDiagram: { [method]: called } });
	return called.mock.calls.map((call) => call[0]);
}

const awkward = fc.constantFrom(
	" ",
	" ",
	'"',
	"'",
	"`",
	"${window.x}",
	"</script>",
	"<!--",
	"\\",
	"\n",
	");window.hacked=1;(",
);

describe("renderCall", () => {
	it("passes the request as data", () => {
		const request: RenderRequest = {
			token: 7,
			source: 'flowchart LR\n  A["</script>"] --> B',
			themeVariables: { primaryColor: "#e8f6f5" },
		};
		expect(run(renderCall(request))).toEqual([request]);
	});

	it("keeps a theme variable named __proto__ as a variable", () => {
		const themeVariables = JSON.parse('{"__proto__":"x"}') as Record<string, string>;
		const request: RenderRequest = { token: 1, source: "", themeVariables };
		const [called] = run(renderCall(request)) as RenderRequest[];
		expect(Object.keys(called.themeVariables)).toEqual(["__proto__"]);
	});

	it("calls render once with an equal request for any source and theme", () => {
		const text = fc.oneof(
			fc.string({ unit: "grapheme" }),
			fc.string({ unit: "binary" }),
			fc.array(fc.oneof(awkward, fc.string()), { maxLength: 8 }).map((parts) => parts.join("")),
		);
		fc.assert(
			fc.property(
				fc.nat(),
				text,
				fc.dictionary(fc.string(), text, { maxKeys: 4 }),
				(token, source, themeVariables) => {
					const request = { token, source, themeVariables };
					expect(run(renderCall(request))).toEqual([request]);
				},
			),
		);
	});

	it("passes a zoom control's action as data", () => {
		expect(run(zoomCall({ kind: "zoom", factor: 1.3 }), "zoom")).toEqual([
			{ kind: "zoom", factor: 1.3 },
		]);
		expect(run(zoomCall({ kind: "reset" }), "zoom")).toEqual([{ kind: "reset" }]);
	});
});
