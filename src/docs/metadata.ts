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
// Allow room for the opening/closing fences, BOM, and line endings around 64 KiB of YAML.
// Disk reads use this prefix plus one sentinel byte to detect truncation.
export const MAX_METADATA_PREFIX_BYTES = MAX_YAML_BYTES + 32;

function boundedFrontmatter(
	source: string,
	truncated: boolean,
): { source?: string; oversized: boolean } {
	// Encode only a bounded slice. UTF-8 bytes, rather than UTF-16 length, set the limit.
	const initial = source.slice(0, MAX_METADATA_PREFIX_BYTES + 1);
	const encoded = Buffer.from(initial);
	const clipped =
		truncated || source.length > initial.length || encoded.length > MAX_METADATA_PREFIX_BYTES;
	const decoded = clipped
		? encoded.subarray(0, MAX_METADATA_PREFIX_BYTES).toString("utf8")
		: initial;
	const lastLineEnding = Math.max(decoded.lastIndexOf("\r"), decoded.lastIndexOf("\n"));
	const prefix = clipped ? decoded.slice(0, lastLineEnding + 1) : decoded;
	const opening = /^\uFEFF?---[\t ]*(?:\r\n|\r|\n|$)/.exec(prefix);
	if (!opening) return { oversized: clipped && /^\uFEFF?---[\t ]*$/.test(decoded) };
	const closing = /(?:^|\r\n|\r|\n)---[\t ]*(?:\r\n|\r|\n|$)/g;
	closing.lastIndex = opening[0].length - 1;
	const match = closing.exec(prefix);
	if (match) {
		const end = match.index + match[0].length;
		return { source: prefix.slice(0, end), oversized: false };
	}
	return {
		oversized:
			clipped || Buffer.byteLength(prefix.slice(opening[0].length), "utf8") > MAX_YAML_BYTES,
	};
}

function needsAbsoluteUrl(property: string): boolean {
	return /^og:(?:url|image|audio|video)(?::(?:url|secure_url))?$/i.test(property);
}

/** Parse static page metadata from the leading YAML node without evaluating document code. */
export function parseMetadata(
	source: string,
	truncated = false,
): {
	metadata: DocumentMetadata;
	diagnostics: MetadataDiagnostic[];
} {
	const empty: DocumentMetadata = { openGraph: [] };
	const bounded = boundedFrontmatter(source, truncated);
	const frontmatter = bounded.source ? leadingFrontmatter(bounded.source) : undefined;
	if (!frontmatter && !bounded.oversized) return { metadata: empty, diagnostics: [] };

	const diagnostics: MetadataDiagnostic[] = [];
	const warn = (message: string, node?: Node | null) => {
		const offset = node?.range?.[0];
		const position = offset === undefined ? undefined : counter.linePos(offset);
		diagnostics.push({
			severity: "warning",
			code: "frontmatter-metadata",
			message,
			...(position
				? { line: (frontmatter?.startLine ?? 2) + position.line - 1, column: position.col }
				: {}),
		});
	};
	const counter = new LineCounter();
	if (bounded.oversized) {
		warn("Frontmatter exceeds the 64 KiB metadata parsing limit.");
		return { metadata: empty, diagnostics };
	}
	if (!frontmatter) return { metadata: empty, diagnostics: [] };
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
