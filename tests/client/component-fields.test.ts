import { expect, it } from "vitest";
import { componentFields, updateComponentField } from "../../client/editor/component-fields";

it("edits a literal property without rewriting nested content or expressions", () => {
	const source =
		'<Card title="Old" count={3} enabled={false} data={items.map(makeItem)}>\n  <Badge>Ready</Badge>\n</Card>';
	const title = componentFields(source).fields.find((field) => field.attribute === "title")!;
	const updated = updateComponentField(source, title, 'A "quote" & <tag>');
	expect(updated).toBe(
		'<Card title={"A \\"quote\\" & <tag>"} count={3} enabled={false} data={items.map(makeItem)}>\n  <Badge>Ready</Badge>\n</Card>',
	);
	expect(componentFields(updated).fields.find((field) => field.attribute === "title")?.value).toBe(
		'A "quote" & <tag>',
	);
	expect(componentFields(source).fields.some((field) => field.attribute === "data")).toBe(false);
});

it.each(["<Callout>\n  A note\n</Callout>", "<Badge>Ready</Badge>"])(
	"keeps text editable when cleared and handles MDX special characters in %s",
	(source) => {
		const field = componentFields(source).fields.find((entry) => entry.kind === "content")!;
		const cleared = updateComponentField(source, field, "");
		const empty = componentFields(cleared).fields.find((entry) => entry.kind === "content")!;
		expect(empty.value).toBe("");
		expect(empty.key).toBe(field.key);
		const updated = updateComponentField(cleared, empty, 'Text < > { } & " \\ with\nnewlines');
		expect(componentFields(updated).fields.find((entry) => entry.kind === "content")?.value).toBe(
			'Text < > { } & " \\ with\nnewlines',
		);
	},
);
