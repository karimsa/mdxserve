import { describe, expect, it, jest } from "@jest/globals";
import * as fc from "fast-check";
import { renderCall, type RenderRequest } from "../src/diagram/render-call";

/** Runs the injected call against a fake page, as WebKit would, and gives what `render` got. */
function run(code: string): unknown[] {
	const render = jest.fn();
	// eslint-disable-next-line no-new-func -- running the generated call is the point of the test
	new Function("window", code)({ mdxserveDiagram: { render } });
	return render.mock.calls.map((call) => call[0]);
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
});
