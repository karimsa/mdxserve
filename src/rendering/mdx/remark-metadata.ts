import type { Root, RootContent } from "mdast";
import type { DocumentMetadata } from "../../docs/metadata.js";
import { parseMetadata } from "../../docs/metadata.js";

type Expression = { type: string; [key: string]: unknown };

function literal(value: string): Expression {
	return { type: "Literal", value, raw: JSON.stringify(value) };
}

function property(name: string, value: Expression): Expression {
	return {
		type: "Property",
		key: { type: "Identifier", name },
		value,
		kind: "init",
		method: false,
		shorthand: false,
		computed: false,
	};
}

function object(properties: Expression[]): Expression {
	return { type: "ObjectExpression", properties };
}

function metadataExpression(metadata: DocumentMetadata): Expression {
	const properties: Expression[] = [];
	for (const name of ["title", "description", "canonical"] as const) {
		if (metadata[name] !== undefined) properties.push(property(name, literal(metadata[name])));
	}
	properties.push(
		property("openGraph", {
			type: "ArrayExpression",
			elements: metadata.openGraph.map((item) =>
				object([
					property("property", literal(item.property)),
					property("content", literal(item.content)),
				]),
			),
		}),
	);
	return object(properties);
}

/** Add a static, browser-safe export derived from the same parser as the HTML shell. */
export function remarkMetadata() {
	return (tree: Root, file: { value: unknown }) => {
		const source = String(file.value);
		const { metadata } = parseMetadata(source);
		const declaration = {
			type: "ExportNamedDeclaration",
			declaration: {
				type: "VariableDeclaration",
				kind: "const",
				declarations: [
					{
						type: "VariableDeclarator",
						id: { type: "Identifier", name: "__mdxserveMetadata" },
						init: metadataExpression(metadata),
					},
				],
			},
			specifiers: [],
			source: null,
		};
		tree.children.push({
			type: "mdxjsEsm",
			value: "",
			data: { estree: { type: "Program", sourceType: "module", body: [declaration] } },
		} as unknown as RootContent);
	};
}
