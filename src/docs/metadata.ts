import { z } from "zod";
import { isAlias, isMap, isScalar, LineCounter, parseDocument, visit, type Node } from "yaml";
import { leadingFrontmatter } from "./frontmatter.js";

export interface DocumentMetadata {
	title?: string;
	description?: string;
	canonical?: string;
	openGraph: { property: string; content: string }[];
}

export interface MetadataDiagnostic {
	severity: "warning";
	code: "frontmatter-metadata";
	message: string;
	line?: number;
	column?: number;
}

const stringField = z.string();
const urlField = z
	.url()
	.refine((value) => /^https?:\/\//i.test(value), "Expected an absolute HTTP(S) URL");
const propertyField = z.string().regex(/^og:[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)*$/i);
const contentField = z.union([z.string(), z.number().finite()]).transform(String);
const graphItem = z.object({ property: propertyField, content: contentField });
const MAX_YAML_BYTES = 64 * 1024;

function needsAbsoluteUrl(property: string): boolean {
	return /^og:(?:url|image|audio|video)(?::(?:url|secure_url))?$/i.test(property);
}

/** Parse static page metadata from the leading YAML node without evaluating document code. */
export function parseMetadata(source: string): {
	metadata: DocumentMetadata;
	diagnostics: MetadataDiagnostic[];
} {
	const empty: DocumentMetadata = { openGraph: [] };
	const frontmatter = leadingFrontmatter(source);
	if (!frontmatter) return { metadata: empty, diagnostics: [] };

	const diagnostics: MetadataDiagnostic[] = [];
	const warn = (message: string, node?: Node | null) => {
		const offset = node?.range?.[0];
		const position = offset === undefined ? undefined : counter.linePos(offset);
		diagnostics.push({
			severity: "warning",
			code: "frontmatter-metadata",
			message,
			...(position
				? { line: frontmatter.startLine + position.line - 1, column: position.col }
				: {}),
		});
	};
	const counter = new LineCounter();
	if (Buffer.byteLength(frontmatter.value, "utf8") > MAX_YAML_BYTES) {
		warn("Frontmatter exceeds the 64 KiB metadata parsing limit.");
		return { metadata: empty, diagnostics };
	}

	let document;
	try {
		document = parseDocument(frontmatter.value, { lineCounter: counter, uniqueKeys: true });
	} catch (error) {
		warn(
			`Cannot parse frontmatter metadata: ${error instanceof Error ? error.message : String(error)}.`,
		);
		return { metadata: empty, diagnostics };
	}
	for (const error of document.errors) {
		const position = counter.linePos(error.pos[0]);
		diagnostics.push({
			severity: "warning",
			code: "frontmatter-metadata",
			message: error.message,
			line: frontmatter.startLine + position.line - 1,
			column: position.col,
		});
	}
	if (document.errors.length) return { metadata: empty, diagnostics };

	let unsafeNode = false;
	try {
		visit(document, {
			Node(_key, node) {
				if (
					isAlias(node) ||
					("tag" in node &&
						!!node.tag &&
						!/^tag:yaml.org,2002:(?:str|int|float|bool|null|seq|map)$/.test(String(node.tag)))
				) {
					warn("YAML aliases and custom tags are not supported in metadata.", node);
					unsafeNode = true;
				}
			},
		});
	} catch (error) {
		warn(
			`Cannot inspect frontmatter metadata: ${error instanceof Error ? error.message : String(error)}.`,
		);
		return { metadata: empty, diagnostics };
	}
	if (unsafeNode) return { metadata: empty, diagnostics };
	if (!isMap(document.contents)) return { metadata: empty, diagnostics: [] };

	const metadata: DocumentMetadata = { openGraph: [] };
	for (const pair of document.contents.items) {
		if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
		const field = pair.key.value;
		if (field === "title" || field === "description" || field === "canonical") {
			const parsed = (field === "canonical" ? urlField : stringField).safeParse(
				isScalar(pair.value) ? pair.value.value : undefined,
			);
			if (!parsed.success)
				warn(
					`Invalid ${field}: ${parsed.error.issues[0]?.message ?? "expected a string"}.`,
					pair.value ?? pair.key,
				);
			else metadata[field] = parsed.data;
		} else if (field === "openGraph") {
			if (
				!pair.value ||
				!("items" in pair.value) ||
				!Array.isArray(pair.value.items) ||
				isMap(pair.value)
			) {
				warn("Invalid openGraph: expected an ordered list.", pair.value ?? pair.key);
				continue;
			}
			for (const item of pair.value.items) {
				if (!isMap(item)) {
					warn("Invalid openGraph item: expected property and content.", item);
					continue;
				}
				const raw = Object.fromEntries(
					item.items.map((entry) => [
						isScalar(entry.key) ? String(entry.key.value) : "",
						isScalar(entry.value) ? entry.value.value : undefined,
					]),
				);
				const parsed = graphItem.safeParse(raw);
				if (!parsed.success) {
					warn(
						`Invalid openGraph item: ${parsed.error.issues[0]?.message ?? "expected property and content"}.`,
						item,
					);
					continue;
				}
				if (
					needsAbsoluteUrl(parsed.data.property) &&
					!urlField.safeParse(parsed.data.content).success
				) {
					warn(`Invalid ${parsed.data.property}: expected an absolute HTTP(S) URL.`, item);
					continue;
				}
				metadata.openGraph.push(parsed.data);
			}
		}
	}
	return { metadata: diagnostics.length ? empty : metadata, diagnostics };
}
