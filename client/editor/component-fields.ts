import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { mdxjs } from "micromark-extension-mdxjs";
import type { RootContent } from "mdast";

export interface ComponentField {
	key: string;
	label: string;
	value: string;
	kind: "text" | "number" | "boolean" | "content";
	from: number;
	to: number;
	attribute?: string;
}

/** Expose literal values without evaluating expressions or rewriting surrounding source. */
export function componentFields(source: string): { name: string; fields: ComponentField[] } {
	const fields: ComponentField[] = [];
	try {
		const tree = fromMarkdown(source, {
			extensions: [mdxjs()],
			mdastExtensions: [mdxFromMarkdown()],
		});
		const root = tree.children[0];
		const first =
			root?.type === "paragraph" && root.children.length === 1 ? root.children[0] : root;
		if (first?.type !== "mdxJsxFlowElement" && first?.type !== "mdxJsxTextElement")
			return { name: "Custom block", fields };
		function visit(node: RootContent, path: string, label: string) {
			if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
				for (const attribute of node.attributes) {
					if (attribute.type !== "mdxJsxAttribute" || typeof attribute.name !== "string") continue;
					const from = attribute.position?.start.offset;
					const to = attribute.position?.end.offset;
					if (from === undefined || to === undefined) continue;
					let value: unknown = attribute.value;
					if (value === null) value = true;
					else if (typeof value === "object") {
						try {
							value = JSON.parse((value as { value: string }).value);
						} catch {
							continue;
						}
					}
					if (!["string", "number", "boolean"].includes(typeof value)) continue;
					fields.push({
						key: `${path}:${attribute.name}`,
						label: `${label} ${attribute.name}`,
						value: String(value),
						kind:
							typeof value === "string" ? "text" : typeof value === "number" ? "number" : "boolean",
						from,
						to,
						attribute: attribute.name,
					});
				}
			}
			if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
				try {
					const value: unknown = JSON.parse(node.value);
					const from = node.position?.start.offset;
					const to = node.position?.end.offset;
					if (typeof value === "string" && from !== undefined && to !== undefined)
						fields.push({
							key: `${path}:content`,
							label: `${label} text`,
							value,
							kind: "content",
							from,
							to,
						});
				} catch {
					/* Nonliteral expressions stay in the source editor. */
				}
			}
			if ("children" in node) {
				const children = node.children as RootContent[];
				if (children.length === 1 && children[0].type === "text") {
					const child = children[0];
					const from = child.position?.start.offset;
					const to = child.position?.end.offset;
					if (from !== undefined && to !== undefined)
						fields.push({
							key: `${path}:content`,
							label: `${label} text`,
							value: child.value,
							kind: "content",
							from,
							to,
						});
				} else if (
					children.length === 1 &&
					(children[0].type === "mdxTextExpression" ||
						children[0].type === "mdxFlowExpression" ||
						children[0].type === "paragraph")
				) {
					visit(children[0], path, label);
				} else
					children.forEach((child, index) =>
						visit(
							child,
							`${path}.${index}`,
							child.type === "mdxJsxFlowElement" || child.type === "mdxJsxTextElement"
								? `${child.name ?? "Component"} ${index + 1}`
								: label,
						),
					);
			}
		}
		visit(first, "root", first.name ?? "Component");
		return { name: first.name ?? "Component", fields };
	} catch {
		return { name: "Custom block", fields };
	}
}

export function updateComponentField(source: string, field: ComponentField, value: string): string {
	let replacement: string;
	if (field.kind === "content") {
		replacement = `{${JSON.stringify(value)}}`;
	} else {
		const literal =
			field.kind === "boolean" ? value === "true" : field.kind === "number" ? Number(value) : value;
		if (typeof literal === "number" && (!value.trim() || !Number.isFinite(literal))) return source;
		replacement = `${field.attribute}={${JSON.stringify(literal)}}`;
	}
	return source.slice(0, field.from) + replacement + source.slice(field.to);
}
