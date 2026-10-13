import type { Root, RootContent } from "mdast";
import type { Pattern, Program, Declaration } from "estree";
import type { VFile } from "vfile";
import type { DocumentMetadata } from "../../docs/metadata.js";
import type { MetadataPort } from "../../docs/metadata-port.js";

const METADATA_EXPORT = "__mdxserveMetadata";

function bindsMetadataName(pattern: Pattern): boolean {
	switch (pattern.type) {
		case "Identifier":
			return pattern.name === METADATA_EXPORT;
		case "ObjectPattern":
			return pattern.properties.some((entry) =>
				bindsMetadataName(entry.type === "RestElement" ? entry.argument : (entry.value as Pattern)),
			);
		case "ArrayPattern":
			return pattern.elements.some((element) => element !== null && bindsMetadataName(element));
		case "AssignmentPattern":
			return bindsMetadataName(pattern.left);
		case "RestElement":
			return bindsMetadataName(pattern.argument);
		default:
			return false;
	}
}

function declarationBindsMetadata(declaration: Declaration): boolean {
	return declaration.type === "VariableDeclaration"
		? declaration.declarations.some((item) => bindsMetadataName(item.id))
		: declaration.id?.name === METADATA_EXPORT;
}

function reservesMetadataExport(program: Program): boolean {
	return program.body.some((statement) => {
		if (statement.type === "ImportDeclaration")
			return statement.specifiers.some((specifier) => specifier.local.name === METADATA_EXPORT);
		if (statement.type === "ExportNamedDeclaration")
			return (
				(statement.declaration != null && declarationBindsMetadata(statement.declaration)) ||
				statement.specifiers.some((specifier) =>
					specifier.exported.type === "Identifier"
						? specifier.exported.name === METADATA_EXPORT
						: specifier.exported.value === METADATA_EXPORT,
				)
			);
		if (statement.type === "ExportAllDeclaration" && statement.exported)
			return statement.exported.type === "Identifier"
				? statement.exported.name === METADATA_EXPORT
				: statement.exported.value === METADATA_EXPORT;
		if (statement.type === "ExportDefaultDeclaration") {
			const declaration = statement.declaration;
			return (
				(declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
				declaration.id?.name === METADATA_EXPORT
			);
		}
		return false;
	});
}

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
export function remarkMetadata(metadataPort: MetadataPort) {
	return (tree: Root, file: VFile) => {
		for (const node of tree.children) {
			if (node.type !== "mdxjsEsm") continue;
			const program = node.data?.estree as Program | undefined;
			if (program && reservesMetadataExport(program)) {
				file.fail(
					`${METADATA_EXPORT} is reserved for mdxserve page metadata; rename this binding or export.`,
					node,
					"mdxserve:reserved-metadata-export",
				);
			}
		}
		const source = String(file.value);
		const { metadata } = metadataPort.parseMetadata(source);
		const declaration = {
			type: "ExportNamedDeclaration",
			declaration: {
				type: "VariableDeclaration",
				kind: "const",
				declarations: [
					{
						type: "VariableDeclarator",
						id: { type: "Identifier", name: METADATA_EXPORT },
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
